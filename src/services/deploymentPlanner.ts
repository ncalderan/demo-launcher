import type {
  CriblObjectSpec,
  DeploymentAction,
  DeploymentOp,
  DeploymentPlan,
  DestinationProfile,
  PreflightResult,
  PresentationMode,
  ProcessingProfile,
  ReplaySample,
  RouteStep,
  RunMode,
  RunReadiness,
  ScenarioSelection,
  SourceProfile,
  UseCaseTemplate,
} from '../domain/types';
import {
  FALLBACK_DESTINATION_IDS,
  breakerRulesetForDatagenSample,
  destinationProfileById,
  packForDatagenSample,
  policyOverlayById,
  presentationModeById,
  processingProfileById,
  runModeById,
  sourceProfileById,
  useCaseTemplateById,
  visualOutcomeProfileById,
} from '../domain/registry';
import {
  SECURITY_DATASET_ID,
  SECURITY_DATASET_META,
  SECURITY_FEEDS,
  buildIncidentData,
} from '../domain/samples/security';
import { LAKE_DIRECT_ACCESS_ID, LAKE_INGEST_TOKEN_KV_KEY } from './criblApi';

/** Internal datagen sample id that marks the AI/OTel replay path. */
const OTEL_SAMPLE = 'claude_code_otel';

/** Use case that runs the historical-backfill (AI Investigator) path. */
const AI_SECURITY_USE_CASE = 'uc-ai-security-investigation';
/**
 * Use case that routes a chosen source natively into an SE-picked, already
 * provisioned Cribl Search Lakehouse engine — no federated Lake dataset, no
 * SIEM pack/pipeline, no destination tiles. See `uc-lakehouse-engine` in
 * `useCaseTemplates.ts` and `requiresSearchEngine` on `UseCaseTemplate`.
 */
const LAKEHOUSE_ENGINE_USE_CASE = 'uc-lakehouse-engine';
/**
 * How far back the security-backfill events span. Defaults to a 90-day archive
 * so the demo showcases federated search over data that has already aged out of
 * a typical SIEM retention window — if it were only a few days, the customer
 * would just use their SIEM.
 */
const SECURITY_WINDOW_DAYS = 90;
const SECURITY_WINDOW_HOURS = SECURITY_WINDOW_DAYS * 24;

let planCounter = 0;
const nextId = (prefix: string) => `${prefix}-${(planCounter += 1)}`;

const DEFAULT_EPS = 10;

/** Global tag applied to every object this app creates, for QuickConnect filtering. */
export const DEMO_TAG = 'SE-Demo-Launcher';

/** Fill any missing selection fields from the use case's opinionated defaults. */
export function selectionWithDefaults(
  useCaseId: string,
  partial?: Partial<ScenarioSelection>,
): ScenarioSelection {
  const useCase = useCaseTemplateById.get(useCaseId);
  if (!useCase) {
    throw new Error(`Unknown use case: ${useCaseId}`);
  }
  const d = useCase.defaults;
  return {
    useCaseId,
    runMode: partial?.runMode ?? 'standard',
    groupId: partial?.groupId ?? 'default',
    sourceProfileId: partial?.sourceProfileId ?? d.sourceProfileId,
    presentationModeId: partial?.presentationModeId ?? d.presentationModeId,
    destinationIds:
      partial?.destinationIds && partial.destinationIds.length > 0
        ? partial.destinationIds
        : d.destinationIds,
    processingId: partial?.processingId ?? d.processingId,
    overlayIds: partial?.overlayIds ?? [],
    visualOutcomeIds:
      partial?.visualOutcomeIds && partial.visualOutcomeIds.length > 0
        ? partial.visualOutcomeIds
        : d.visualOutcomeIds,
  };
}

function conditionForRole(role: string): string | undefined {
  switch (role) {
    case 'siem-analytics':
      return 'priority / security-relevant events';
    case 'low-cost-store':
      return 'lower-priority & retention data';
    case 'compliance-archive':
      return 'in-region compliance copy';
    case 'operations':
      return 'operational / troubleshooting events';
    default:
      return undefined;
  }
}

function buildRoute(sourceName: string, destinations: DestinationProfile[]): RouteStep[] {
  return destinations.map((dest) => ({
    from: sourceName,
    to: dest.displayName,
    condition: conditionForRole(dest.role),
  }));
}

/** Apply fallback substitution for destinations flagged unavailable by preflight. */
function resolveDestinations(
  selection: ScenarioSelection,
  preflight?: PreflightResult,
): { destinations: DestinationProfile[]; readiness: RunReadiness } {
  const forcedFallbackIds = new Set(
    (preflight?.checks ?? [])
      .filter((c) => c.forcesFallback)
      .map((c) => c.id.replace(/^pf-dest-/, '')),
  );

  const ids: string[] = [];
  let substituted = false;
  for (const id of selection.destinationIds) {
    if (forcedFallbackIds.has(id)) {
      substituted = true;
      for (const fb of FALLBACK_DESTINATION_IDS) if (!ids.includes(fb)) ids.push(fb);
    } else if (!ids.includes(id)) {
      ids.push(id);
    }
  }

  const destinations = ids
    .map((id) => destinationProfileById.get(id))
    .filter((d): d is DestinationProfile => Boolean(d));

  return { destinations, readiness: substituted ? 'fallback' : 'full' };
}

/** Stable, id-safe token so redeploying the same scenario is idempotent. */
function scenarioToken(selection: ScenarioSelection): string {
  const uc = selection.useCaseId.replace(/^uc-/, '').replace(/-/g, '');
  const src = selection.sourceProfileId.replace(/^src-/, '').replace(/-/g, '');
  return `${uc}_${src}`.slice(0, 40);
}

function shortId(id: string): string {
  return id.replace(/^dst-/, '').replace(/-/g, '');
}

/**
 * Built-in datagen sample used purely as a *clock* for replay sources. Its own
 * content is irrelevant — the replay pipeline overwrites `_raw` on every tick.
 * We reuse a Cribl built-in that is known to exist so the generator always
 * creates cleanly (custom datagen files can't be created via the REST API).
 */
const REPLAY_HEARTBEAT_SAMPLE = 'palo_alto_traffic';

/**
 * Build the replay pipeline conf: on every generated tick, overwrite `_raw` with
 * one of the app-shipped sample events (picked at random) and stamp Splunk-style
 * metadata so the event presents as genuine telemetry and the pack's route
 * matches. This is how we "provide our own data" without a Cribl datagen file.
 */
function buildReplayPipelineConf(replay: ReplaySample): Record<string, unknown> {
  const arrayLiteral = JSON.stringify(replay.events);
  const n = replay.events.length;
  const add: Array<{ name: string; value: string }> = [
    { name: '_raw', value: `${arrayLiteral}[Math.floor(Math.random()*${n})]` },
    { name: 'sourcetype', value: `'${replay.sourcetype}'` },
    { name: 'source', value: `'${replay.source}'` },
  ];
  if (replay.index) add.push({ name: 'index', value: `'${replay.index}'` });
  return {
    output: 'default',
    groups: {},
    asyncFuncTimeout: 1000,
    description: 'Replay app-shipped sample events into _raw (SE Demo Launcher)',
    functions: [{ id: 'eval', filter: 'true', conf: { add } }],
  };
}

/**
 * Build the loop output that feeds datagen events into the visible listener.
 * Intentionally UNtagged: this is backend plumbing that must stay out of the
 * SE's QuickConnect view when filtering by the demo tags.
 */
function buildLoopOutput(source: SourceProfile): Record<string, unknown> {
  const common = {
    host: '127.0.0.1',
    port: source.defaultPort,
    loadBalanced: false,
    tls: { disabled: true },
    description: `Internal loop → ${source.displayName}`,
  };
  // Cribl has no `tcp` OUTPUT type (only `tcpjson`); syslog is a valid output.
  return source.loopListenerKind === 'syslog'
    ? { type: 'syslog', protocol: 'tcp', ...common }
    : { type: 'tcpjson', ...common };
}

/** Build the visible listener source with QuickConnect connections to destinations. */
function buildSourceInput(
  source: SourceProfile,
  connections: Array<{ output: string }>,
  streamtags: string[],
): Record<string, unknown> {
  const base = {
    host: '0.0.0.0',
    sendToRoutes: false,
    description: source.displayName,
    connections,
    streamtags,
    disabled: false,
  };
  // Pair the listener to the loop output's wire format: syslog↔syslog and
  // tcpjson↔tcpjson (a raw `tcp` input can't decode tcpjson records).
  return source.loopListenerKind === 'syslog'
    ? { type: 'syslog', tcpPort: source.defaultPort, udpPort: source.defaultPort, ...base }
    : { type: 'tcpjson', port: source.defaultPort, ...base };
}

/**
 * Build a real, self-contained Cribl pipeline `conf` from a processing profile.
 * The pipeline is applied to the SIEM QuickConnect connection so the SE can show
 * that the feed going to the SIEM is actually processed: documented steps, a
 * processing stamp, and a light volume reduction to make the effect visible.
 *
 * It deliberately does NOT chain to an external pack — a dangling `pack:` ref
 * would break pipeline creation if the pack isn't installed. The pipeline is
 * named after the profile so the SE can swap in / chain their pack afterward.
 */
function buildPipelineConf(
  processing: DeploymentPlan['processing'],
  streamtags: string[],
): Record<string, unknown> {
  const stepComment = processing.steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
  const functions: Array<Record<string, unknown>> = [
    {
      id: 'comment',
      filter: 'true',
      conf: {
        comment: `${processing.displayName}${
          processing.packRef ? ` (pack: ${processing.packRef})` : ''
        }\n${stepComment}`,
      },
    },
    {
      id: 'eval',
      filter: 'true',
      conf: {
        add: [
          { name: 'cribl_demo_processing', value: `'${processing.id}'` },
          { name: 'cribl_demo_launcher', value: "'true'" },
        ],
      },
    },
    // Light, safe volume reduction so the SIEM feed is visibly optimized.
    { id: 'sampling', filter: 'true', conf: { rules: [{ filter: 'true', rate: 2 }] } },
  ];
  return {
    output: 'default',
    streamtags,
    groups: {},
    asyncFuncTimeout: 1000,
    description: `${processing.displayName} (SE Demo Launcher)`,
    functions,
  };
}

/**
 * Build the OTel AI-enrichment pipeline for the AI Observability use case
 * (there is no SIEM split — runs on every feed). Parses the replayed Claude
 * Code OTel JSON out of `_raw`, then builds one genuine OTLP/HTTP logs
 * envelope per event (`_otlpLogsEnvelope`).
 *
 * We deliberately do NOT try to write into the real "AI Observability" app's
 * own dataset (`AI-o11y`) or replicate its ingestion pack (normalizer, Cribl
 * Guard, Metrics Engine) — that's cross-app-blocked and out of scope. Sending
 * genuine Claude Code OTLP to the app's own OTLP/HTTP listener (its README
 * explicitly lists Claude Code CLI as a supported client) lets its own
 * normalizer do that work; we just need to be a faithful Claude Code emitter.
 *
 * Every field choice below is ground-truthed against LIVE Claude Code
 * telemetry found in this org's own `AI-o11y` dataset during this build —
 * not the public docs, not guessed:
 *
 *   - `__ai_core_ok` (required for ANY event to land in the real dataset,
 *     read from the real `ai-o11y-otelPipe` pipeline code) requires
 *     `user_email`/`user_id` non-empty, read from
 *     `attributes['user.email']`/`attributes['user.id']` on the LOG RECORD
 *     itself — NOT the resource block. Stamped on every event below.
 *   - `trace_id` is read from `attributes['prompt.id']`. Live data confirmed
 *     every event belonging to one conversational "turn" — user_prompt,
 *     api_request, tool_decision/tool_result, assistant_response — carries
 *     the SAME `prompt.id`, which is what lets Sessions & Traces group a
 *     whole turn into one trace instead of N disconnected spans.
 *   - `span_id` falls back `attributes['span.id'] || request_id ||
 *     tool_use_id || time_unix_nano`. Live data confirmed a tool_decision
 *     and its tool_result share one `tool_use_id`, which is how they group
 *     as a pair; api_request/assistant_response each carry their own
 *     `request_id`.
 *   - No metrics envelope: a standalone OTLP metrics payload is
 *     unconditionally marked `ai_normalization_rejected` (confirmed in the
 *     real pipeline code) before any content is inspected. The real Usage &
 *     Cost metrics (`__ai_metrics_ok`) are derived from this SAME
 *     `claude_code.api_request` log record instead, gated on it carrying
 *     `input_tokens`/`cost` — one logs envelope feeds both Sessions & Traces
 *     and Usage & Cost.
 *   - Resource attributes match the real client's shape (`service.name`,
 *     `service.version`, `host.arch`, `os.type`, `os.version`) rather than
 *     our earlier invented set — the real pipeline reads
 *     `resource.attributes['service.name']`/`['service.version']` to build
 *     its own `source` display field (e.g. "claude-code-2.1.308"); without
 *     this it falls back to "unknown-unknown", confirmed live.
 */
function buildOtelEnrichPipelineConf(streamtags: string[]): Record<string, unknown> {
  // Cribl eval `value`s must be a single expression with NO nested scope —
  // no `function`/arrow-with-block-body is allowed at all (confirmed live:
  // "Expression cannot have nested scopes"), so every expression below is
  // built from plain object/array literals, ternaries, and spread — never a
  // function definition, only function CALLS like String()/Number().
  const resourceAttrsExpr = `[
    {key:'service.name',value:{stringValue:'claude-code'}},
    {key:'service.version',value:{stringValue:'2.1.308'}},
    {key:'host.arch',value:{stringValue:'arm64'}},
    {key:'os.type',value:{stringValue:'darwin'}},
    {key:'os.version',value:{stringValue:'27.0.0'}}
  ]`;

  // Per-event-type OTLP attributes, matching the real app's own
  // `ai-o11y-otelPipe` field mapping (confirmed against live data, not
  // guessed). `session.id`/`user.id`/`user.email`/`prompt.id` go on EVERY
  // event — `prompt.id` is the cross-event trace correlator (see doc
  // comment above).
  const logAttrsExpr = `[
    {key:'event.name',value:{stringValue:event_name}},
    {key:'session.id',value:{stringValue:String(session_id||'')}},
    {key:'user.id',value:{stringValue:String(user_id||'')}},
    {key:'user.email',value:{stringValue:String(user_email||'')}},
    {key:'prompt.id',value:{stringValue:String(prompt_id||'')}},
    ...(event_name === 'claude_code.user_prompt' ? [
      {key:'prompt',value:{stringValue:String(prompt||'')}},
      {key:'prompt_length',value:{intValue:String(prompt_length||0)}}
    ] : event_name === 'claude_code.api_request' ? [
      {key:'model',value:{stringValue:String(model||'')}},
      {key:'cost_usd',value:{doubleValue:Number(cost_usd||0)}},
      {key:'duration_ms',value:{intValue:String(duration_ms||0)}},
      {key:'input_tokens',value:{intValue:String(input_tokens||0)}},
      {key:'output_tokens',value:{intValue:String(output_tokens||0)}},
      {key:'cache_read_tokens',value:{intValue:String(cache_read_tokens||0)}},
      {key:'cache_creation_tokens',value:{intValue:String(cache_creation_tokens||0)}},
      {key:'request_id',value:{stringValue:String(request_id||'')}}
    ] : event_name === 'claude_code.assistant_response' ? [
      {key:'model',value:{stringValue:String(model||'')}},
      {key:'response',value:{stringValue:String(response||'')}},
      {key:'response_length',value:{intValue:String(response_length||0)}},
      {key:'request_id',value:{stringValue:String(request_id||'')}}
    ] : event_name === 'claude_code.tool_decision' ? [
      {key:'tool_name',value:{stringValue:String(tool_name||'')}},
      {key:'decision',value:{stringValue:String(decision||'')}},
      {key:'tool_use_id',value:{stringValue:String(tool_use_id||'')}}
    ] : event_name === 'claude_code.tool_result' ? [
      {key:'tool_name',value:{stringValue:String(tool_name||'')}},
      {key:'success',value:{boolValue:Boolean(success)}},
      {key:'duration_ms',value:{intValue:String(duration_ms||0)}},
      {key:'tool_use_id',value:{stringValue:String(tool_use_id||'')}}
    ] : [])
  ]`;

  const functions: Array<Record<string, unknown>> = [
    // 1. Parse the OTel JSON event from _raw into top-level fields.
    {
      id: 'serde',
      filter: 'true',
      conf: { mode: 'extract', type: 'json', srcField: '_raw', cleanFields: false },
    },
    // 2. Shared OTLP building blocks: a nanosecond timestamp, the resource
    //    attributes (same on every signal), and this event's log attributes.
    {
      id: 'eval',
      filter: 'true',
      conf: {
        add: [
          { name: '_nowNano', value: "String(Date.now())+'000000'" },
          { name: '_otlpResource', value: resourceAttrsExpr },
          { name: '_otlpAttrs', value: logAttrsExpr },
        ],
      },
    },
    // 3. The OTLP/HTTP logs envelope — every event gets one. This alone
    //    feeds both Sessions & Traces and Usage & Cost on the real app's
    //    side (see the function doc comment above for why there's no
    //    separate metrics envelope).
    {
      id: 'eval',
      filter: 'true',
      conf: {
        add: [
          {
            name: '_otlpLogsEnvelope',
            value:
              "JSON.stringify({resourceLogs:[{resource:{attributes:_otlpResource},scopeLogs:[{scope:{name:'com.anthropic.claude_code'},logRecords:[{timeUnixNano:_nowNano,observedTimeUnixNano:_nowNano,severityNumber:9,severityText:'INFO',body:{stringValue:event_name},attributes:_otlpAttrs}]}]}]})",
          },
        ],
      },
    },
    // 4. Demo/source metadata.
    {
      id: 'eval',
      filter: 'true',
      conf: {
        add: [
          { name: 'cribl_demo_launcher', value: "'true'" },
          { name: 'sourcetype', value: "'claude_code:otel'" },
        ],
      },
    },
  ];
  return {
    output: 'default',
    streamtags,
    groups: {},
    asyncFuncTimeout: 1000,
    description:
      'AI Observability enrichment — builds a genuine Claude Code OTLP logs envelope for the real app’s own OTLP/HTTP listener',
    functions,
  };
}

const LAKE_STAGE_PATH = '$CRIBL_HOME/state/outputs/staging';

/**
 * Cribl.Cloud exposes a single Lake whose id is `default`. Every Cribl Lake
 * dataset we create lives under it, and datasets automatically become Cribl
 * Search locations (queryable as `dataset="<id>"`).
 */
const LAKE_ID = 'default';

/**
 * Id of the dedicated, per-demo Cribl Lake dataset. Each scenario creates its
 * own dataset (rather than sharing `default_logs`), points its Lake destination
 * at it, and builds the saved search + dashboard on top of it. Lake dataset ids
 * allow letters, numbers, and underscores; keep it comfortably short.
 */
function demoDatasetId(token: string): string {
  return `demo_${token}`.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 60);
}

/**
 * Cribl Search enforces `^[a-zA-Z0-9 _-]+$` on saved-search and dashboard names,
 * so em-dashes, slashes, and other punctuation in our titles are rejected. Fold
 * anything outside the allowed set to a hyphen and collapse repeats.
 */
function sanitizeSearchName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9 _-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/(^[\s-]+|[\s-]+$)/g, '')
    .slice(0, 256);
}

/**
 * Search-time parsing for a scenario's data.
 *
 * Most sources are parsed inline at query time with `extract()` regex against
 * `_raw` — it returns null on no-match and so never fails execution, and needs
 * no datatype bound to the dataset. PAN traffic is the exception: it returns
 * an empty parse clause and relies entirely on the "Palo Alto Datatypes"
 * breaker ruleset being bound to the dataset (see the `apply-datatype` action
 * built from `breakerRulesetForDatagenSample` in `buildDeploymentPlan`) to
 * land `source_ip`/`destination_ip`/`application`/`action`/`bytes` etc. —
 * without that binding, its panels query fields that don't exist.
 * Returns the parse clause plus the fields to show and to group the volume panel
 * by, so the saved search and dashboard surface real fields instead of `_raw`.
 */
interface SearchParseSpec {
  parse: string;
  projectFields: string[];
  groupBy: { field: string; label: string };
}

function searchParseForSample(datagenSample: string): SearchParseSpec {
  switch (datagenSample) {
    case 'palo_alto_traffic':
    case 'generic_tcp_policy':
      // Parsed natively by the "Palo Alto Datatypes" Lake breaker ruleset
      // (attached to the dataset), so fields land already extracted — no
      // search-time split needed. `bytes` arrives as a string; cast when summing.
      return {
        parse: '',
        projectFields: [
          '_time',
          'source_ip',
          'destination_ip',
          'application',
          'protocol',
          'action',
          'bytes',
          'session_end_reason',
        ],
        groupBy: { field: 'action', label: 'action' },
      };
    case 'linux_syslog':
      return {
        parse: [
          '| extend program = extract("([A-Za-z0-9_./-]+)(?:\\\\[[0-9]+\\\\])?:\\\\s", 1, _raw)',
          '| extend src_ip = extract("from ([0-9]{1,3}(?:\\\\.[0-9]{1,3}){3})", 1, _raw)',
          '| extend auth_result = extract("(Accepted|Failed) (?:password|publickey)", 1, _raw)',
        ].join('\n'),
        projectFields: ['_time', 'host', 'program', 'auth_result', 'src_ip', 'message'],
        groupBy: { field: 'program', label: 'program' },
      };
    case 'cisco_asa':
      // `%ASA-#-######:` syslog lines (see domain/samples/ciscoAsa.ts). The
      // action word (Built/Teardown/Deny/Denied/access-list/Group) is the
      // token right after the message id; src_ip is simply the first IP in
      // the line (every sample line carries one as the primary endpoint).
      return {
        parse: [
          '| extend asa_id = extract("%ASA-[0-9]+-([0-9]+):", 1, _raw)',
          '| extend action = extract("%ASA-[0-9]+-[0-9]+:\\\\s+(\\\\w+)", 1, _raw)',
          '| extend src_ip = extract("([0-9]{1,3}(?:\\\\.[0-9]{1,3}){3})", 1, _raw)',
          '| extend bytes = extract("bytes ([0-9]+)", 1, _raw)',
        ].join('\n'),
        projectFields: ['_time', 'action', 'asa_id', 'src_ip', 'bytes'],
        groupBy: { field: 'action', label: 'action' },
      };
    case 'checkpoint_fw':
      // LEA-style key="value" syslog (see domain/samples/checkpoint.ts) —
      // every field is a plain quoted k=v pair, so a direct extract per field.
      return {
        parse: [
          '| extend action = extract("action=\\"([^\\"]*)\\"", 1, _raw)',
          '| extend src = extract("\\\\bsrc=\\"([^\\"]*)\\"", 1, _raw)',
          '| extend dst = extract("\\\\bdst=\\"([^\\"]*)\\"", 1, _raw)',
          '| extend service = extract("service=\\"([^\\"]*)\\"", 1, _raw)',
          '| extend i_f_name = extract("i_f_name=\\"([^\\"]*)\\"", 1, _raw)',
        ].join('\n'),
        projectFields: ['_time', 'action', 'src', 'dst', 'service', 'i_f_name'],
        groupBy: { field: 'action', label: 'action' },
      };
    case 'crowdstrike_falcon':
      // Single-line Falcon detection/event JSON (see domain/samples/crowdstrike.ts).
      // Regex-extract specific key values directly from the JSON text, same
      // verified-safe approach as every other case here rather than a JSON
      // search function.
      return {
        parse: [
          '| extend event_type = extract("\\"eventType\\":\\"([^\\"]*)\\"", 1, _raw)',
          '| extend detect_name = extract("\\"DetectName\\":\\"([^\\"]*)\\"", 1, _raw)',
          '| extend severity_name = extract("\\"SeverityName\\":\\"([^\\"]*)\\"", 1, _raw)',
          '| extend computer_name = extract("\\"ComputerName\\":\\"([^\\"]*)\\"", 1, _raw)',
          '| extend user_name = extract("\\"UserName\\":\\"([^\\"]*)\\"", 1, _raw)',
        ].join('\n'),
        projectFields: ['_time', 'event_type', 'detect_name', 'severity_name', 'computer_name', 'user_name'],
        groupBy: { field: 'severity_name', label: 'severity' },
      };
    case 'f5_bigip':
      // `module[pid]: id: message` syslog (see domain/samples/f5Bigip.ts). ASM
      // WAF-block lines carry an extra `ASM:"blocking","<attack>",...` clause.
      return {
        parse: [
          '| extend module = extract("\\\\s(\\\\w+)\\\\[[0-9]+\\\\]:", 1, _raw)',
          '| extend msg_id = extract("\\\\[[0-9]+\\\\]:\\\\s([0-9]+):", 1, _raw)',
          '| extend waf_attack = extract("ASM:\\"blocking\\",\\"([^\\"]*)\\"", 1, _raw)',
          '| extend client_ip = extract("([0-9]{1,3}(?:\\\\.[0-9]{1,3}){3})", 1, _raw)',
        ].join('\n'),
        projectFields: ['_time', 'module', 'msg_id', 'waf_attack', 'client_ip'],
        groupBy: { field: 'module', label: 'module' },
      };
    case 'zscaler_nss':
      // Single-line NSS web-log JSON (see domain/samples/zscaler.ts).
      return {
        parse: [
          '| extend action = extract("\\"action\\":\\"([^\\"]*)\\"", 1, _raw)',
          '| extend zs_user = extract("\\"user\\":\\"([^\\"]*)\\"", 1, _raw)',
          '| extend web_url = extract("\\"url\\":\\"([^\\"]*)\\"", 1, _raw)',
          '| extend urlcategory = extract("\\"urlcategory\\":\\"([^\\"]*)\\"", 1, _raw)',
          '| extend reason = extract("\\"reason\\":\\"([^\\"]*)\\"", 1, _raw)',
        ].join('\n'),
        projectFields: ['_time', 'zs_user', 'web_url', 'action', 'urlcategory', 'reason'],
        groupBy: { field: 'action', label: 'action' },
      };
    case 'sentinel_windowsevents':
      return {
        parse: [
          '| extend event_id = extract("<EventID[^>]*>([0-9]+)</EventID>", 1, _raw)',
          '| extend channel = extract("<Channel>([^<]+)</Channel>", 1, _raw)',
          '| extend computer = extract("<Computer>([^<]+)</Computer>", 1, _raw)',
        ].join('\n'),
        projectFields: ['_time', 'event_id', 'channel', 'computer'],
        groupBy: { field: 'event_id', label: 'event ID' },
      };
    case OTEL_SAMPLE:
      // AI/OTel events are fully structured at ingest by the enrichment pipeline,
      // so no search-time parse is needed — dashboards query fields directly.
      return {
        parse: '',
        projectFields: ['_time', 'event_name', 'user_email', 'model', 'total_tokens', 'cost_usd', 'subject'],
        groupBy: { field: 'model', label: 'model' },
      };
    default:
      return {
        parse: '',
        projectFields: [],
        groupBy: { field: 'source', label: 'source' },
      };
  }
}

/** A single Cribl Search dashboard element (chart or list visualization). */
interface DashboardElement {
  id: string;
  type: string;
  title: string;
  layout: { x: number; y: number; w: number; h: number };
  search: { type: 'inline'; query: string; earliest: string; latest: string };
}

/**
 * Build the dashboard panels for a scenario. Panels are source-aware and modeled
 * on the Cribl Search content packs:
 *  - Palo Alto (tiered retention) → traffic-over-time, allow/deny split, top apps,
 *    bytes-over-time, top source/destination IPs, recent traffic
 *  - Windows (shared visibility)  → events-over-time, volume by Event ID, logon
 *    success/failure, top computers, events by channel, recent events
 *  - anything else                → volume-by-field + recent events
 * Every query starts with `dataset="…"` (so the executor's id-remap still works)
 * and uses the verified search-time parse clause, since the dataset is plain v1.
 */
function buildDashboardElements(
  datasetId: string,
  parseSpec: SearchParseSpec,
  datagenSample: string,
): DashboardElement[] {
  const parseClause = parseSpec.parse ? `\n${parseSpec.parse}` : '';
  const q = (agg: string) => `dataset="${datasetId}"${parseClause}\n${agg}`;
  const el = (
    id: string,
    type: string,
    title: string,
    agg: string,
    layout: { x: number; y: number; w: number; h: number },
  ): DashboardElement => ({
    id,
    type,
    title,
    layout,
    search: { type: 'inline', query: q(agg), earliest: '-60m', latest: 'now' },
  });

  if (datagenSample === 'palo_alto_traffic' || datagenSample === 'generic_tcp_policy') {
    // Fields below are produced by the "Palo Alto Datatypes" breaker ruleset on
    // the dataset (datatype `pan_traffic`). `bytes` is a string → tolong() to sum.
    return [
      el('pan_traffic_over_time', 'chart.line', 'Traffic volume over time',
        '| summarize events = count() by bin(_time, 5m)\n| sort by _time asc',
        { x: 0, y: 0, w: 12, h: 5 }),
      el('pan_action_split', 'chart.pie', 'Allowed vs denied sessions',
        '| summarize count = count() by action\n| sort by count desc',
        { x: 0, y: 5, w: 4, h: 6 }),
      el('pan_top_apps', 'chart.horizontalBar', 'Top applications',
        '| summarize count = count() by application\n| sort by count desc\n| limit 10',
        { x: 4, y: 5, w: 8, h: 6 }),
      el('pan_bytes_over_time', 'chart.area', 'Bytes transferred over time',
        '| summarize bytes = sum(tolong(bytes)) by bin(_time, 5m)\n| sort by _time asc',
        { x: 0, y: 11, w: 12, h: 5 }),
      el('pan_top_src', 'list.table', 'Top source IPs',
        '| summarize sessions = count(), bytes = sum(tolong(bytes)) by source_ip\n| sort by sessions desc\n| limit 10',
        { x: 0, y: 16, w: 6, h: 6 }),
      el('pan_top_dst', 'list.table', 'Top destination IPs',
        '| summarize sessions = count(), bytes = sum(tolong(bytes)) by destination_ip\n| sort by sessions desc\n| limit 10',
        { x: 6, y: 16, w: 6, h: 6 }),
      el('pan_recent', 'list.events', 'Recent traffic',
        '| project _time, source_ip, destination_ip, application, protocol, action, bytes\n| limit 100',
        { x: 0, y: 22, w: 12, h: 8 }),
    ];
  }

  if (datagenSample === 'sentinel_windowsevents') {
    return [
      el('win_events_over_time', 'chart.line', 'Windows events over time',
        '| summarize events = count() by bin(_time, 5m)\n| sort by _time asc',
        { x: 0, y: 0, w: 12, h: 5 }),
      el('win_by_eventid', 'chart.column', 'Volume by Event ID',
        '| summarize count = count() by event_id\n| sort by count desc\n| limit 15',
        { x: 0, y: 5, w: 8, h: 6 }),
      el('win_logon_split', 'chart.pie', 'Logon success vs failure',
        '| extend logon = case(event_id == "4624", "Success", event_id == "4625", "Failure", "Other")\n| where logon != "Other"\n| summarize count = count() by logon',
        { x: 8, y: 5, w: 4, h: 6 }),
      el('win_top_computers', 'list.table', 'Top computers',
        '| summarize events = count() by computer\n| sort by events desc\n| limit 10',
        { x: 0, y: 11, w: 6, h: 6 }),
      el('win_by_channel', 'list.table', 'Events by channel',
        '| summarize events = count() by channel\n| sort by events desc\n| limit 10',
        { x: 6, y: 11, w: 6, h: 6 }),
      el('win_recent', 'list.events', 'Recent Windows events',
        '| project _time, event_id, channel, computer\n| limit 100',
        { x: 0, y: 17, w: 12, h: 8 }),
    ];
  }

  if (datagenSample === 'linux_syslog') {
    return [
      el('linux_events_over_time', 'chart.line', 'Events over time',
        '| summarize events = count() by bin(_time, 5m)\n| sort by _time asc',
        { x: 0, y: 0, w: 12, h: 5 }),
      el('linux_auth_split', 'chart.pie', 'Auth result split',
        '| summarize count = count() by auth_result\n| sort by count desc',
        { x: 0, y: 5, w: 4, h: 6 }),
      el('linux_top_programs', 'list.table', 'Top programs',
        '| summarize count = count() by program\n| sort by count desc\n| limit 10',
        { x: 4, y: 5, w: 8, h: 6 }),
      el('linux_top_src', 'list.table', 'Top source IPs (auth events)',
        '| summarize count = count() by src_ip\n| sort by count desc\n| limit 10',
        { x: 0, y: 11, w: 12, h: 6 }),
      el('linux_recent', 'list.events', 'Recent events',
        '| project _time, host, program, auth_result, src_ip, message\n| limit 100',
        { x: 0, y: 17, w: 12, h: 8 }),
    ];
  }

  if (datagenSample === 'cisco_asa') {
    return [
      el('asa_connections_over_time', 'chart.line', 'Connections over time',
        '| summarize events = count() by bin(_time, 5m)\n| sort by _time asc',
        { x: 0, y: 0, w: 12, h: 5 }),
      el('asa_action_split', 'chart.pie', 'Action split',
        '| summarize count = count() by action\n| sort by count desc',
        { x: 0, y: 5, w: 4, h: 6 }),
      el('asa_top_src', 'list.table', 'Top source IPs',
        '| summarize count = count() by src_ip\n| sort by count desc\n| limit 10',
        { x: 4, y: 5, w: 8, h: 6 }),
      el('asa_bytes_over_time', 'chart.area', 'Bytes transferred over time',
        '| summarize bytes = sum(tolong(bytes)) by bin(_time, 5m)\n| sort by _time asc',
        { x: 0, y: 11, w: 12, h: 5 }),
      el('asa_recent', 'list.events', 'Recent connections',
        '| project _time, action, asa_id, src_ip, bytes\n| limit 100',
        { x: 0, y: 16, w: 12, h: 8 }),
    ];
  }

  if (datagenSample === 'checkpoint_fw') {
    return [
      el('cp_traffic_over_time', 'chart.line', 'Traffic volume over time',
        '| summarize events = count() by bin(_time, 5m)\n| sort by _time asc',
        { x: 0, y: 0, w: 12, h: 5 }),
      el('cp_action_split', 'chart.pie', 'Accept vs drop split',
        '| summarize count = count() by action\n| sort by count desc',
        { x: 0, y: 5, w: 4, h: 6 }),
      el('cp_by_interface', 'list.table', 'Traffic by interface',
        '| summarize count = count() by i_f_name\n| sort by count desc\n| limit 10',
        { x: 4, y: 5, w: 8, h: 6 }),
      el('cp_top_src', 'list.table', 'Top sources',
        '| summarize count = count() by src\n| sort by count desc\n| limit 10',
        { x: 0, y: 11, w: 6, h: 6 }),
      el('cp_top_service', 'list.table', 'Top services',
        '| summarize count = count() by service\n| sort by count desc\n| limit 10',
        { x: 6, y: 11, w: 6, h: 6 }),
      el('cp_recent', 'list.events', 'Recent traffic',
        '| project _time, action, src, dst, service, i_f_name\n| limit 100',
        { x: 0, y: 17, w: 12, h: 8 }),
    ];
  }

  if (datagenSample === 'crowdstrike_falcon') {
    return [
      el('cs_events_over_time', 'chart.line', 'Events over time',
        '| summarize events = count() by bin(_time, 5m)\n| sort by _time asc',
        { x: 0, y: 0, w: 12, h: 5 }),
      el('cs_severity_split', 'chart.pie', 'Severity split',
        '| summarize count = count() by severity_name\n| sort by count desc',
        { x: 0, y: 5, w: 4, h: 6 }),
      el('cs_top_detections', 'list.table', 'Top detections',
        '| summarize count = count() by detect_name\n| sort by count desc\n| limit 10',
        { x: 4, y: 5, w: 8, h: 6 }),
      el('cs_top_computers', 'list.table', 'Top affected computers',
        '| summarize count = count() by computer_name\n| sort by count desc\n| limit 10',
        { x: 0, y: 11, w: 6, h: 6 }),
      el('cs_top_users', 'list.table', 'Top affected users',
        '| summarize count = count() by user_name\n| sort by count desc\n| limit 10',
        { x: 6, y: 11, w: 6, h: 6 }),
      el('cs_recent', 'list.events', 'Recent detections',
        '| project _time, event_type, detect_name, severity_name, computer_name, user_name\n| limit 100',
        { x: 0, y: 17, w: 12, h: 8 }),
    ];
  }

  if (datagenSample === 'f5_bigip') {
    return [
      el('f5_events_over_time', 'chart.line', 'Events over time',
        '| summarize events = count() by bin(_time, 5m)\n| sort by _time asc',
        { x: 0, y: 0, w: 12, h: 5 }),
      el('f5_by_module', 'chart.pie', 'Events by module',
        '| summarize count = count() by module\n| sort by count desc',
        { x: 0, y: 5, w: 4, h: 6 }),
      el('f5_waf_blocks', 'list.table', 'WAF blocks by attack type',
        '| summarize count = count() by waf_attack\n| sort by count desc\n| limit 10',
        { x: 4, y: 5, w: 8, h: 6 }),
      el('f5_top_clients', 'list.table', 'Top clients',
        '| summarize count = count() by client_ip\n| sort by count desc\n| limit 10',
        { x: 0, y: 11, w: 12, h: 6 }),
      el('f5_recent', 'list.events', 'Recent events',
        '| project _time, module, msg_id, waf_attack, client_ip\n| limit 100',
        { x: 0, y: 17, w: 12, h: 8 }),
    ];
  }

  if (datagenSample === 'zscaler_nss') {
    return [
      el('zs_requests_over_time', 'chart.line', 'Requests over time',
        '| summarize events = count() by bin(_time, 5m)\n| sort by _time asc',
        { x: 0, y: 0, w: 12, h: 5 }),
      el('zs_action_split', 'chart.pie', 'Allowed vs blocked split',
        '| summarize count = count() by action\n| sort by count desc',
        { x: 0, y: 5, w: 4, h: 6 }),
      el('zs_top_reasons', 'list.table', 'Top reasons',
        '| summarize count = count() by reason\n| sort by count desc\n| limit 10',
        { x: 4, y: 5, w: 8, h: 6 }),
      el('zs_top_users', 'list.table', 'Top users',
        '| summarize count = count() by zs_user\n| sort by count desc\n| limit 10',
        { x: 0, y: 11, w: 6, h: 6 }),
      el('zs_top_categories', 'list.table', 'Top URL categories',
        '| summarize count = count() by urlcategory\n| sort by count desc\n| limit 10',
        { x: 6, y: 11, w: 6, h: 6 }),
      el('zs_recent', 'list.events', 'Recent web transactions',
        '| project _time, zs_user, web_url, action, reason, urlcategory\n| limit 100',
        { x: 0, y: 17, w: 12, h: 8 }),
    ];
  }

  const projectClause = parseSpec.projectFields.length
    ? `| project ${parseSpec.projectFields.join(', ')}\n`
    : '';
  return [
    el('element_volume_by_field', 'chart.column', `Event volume by ${parseSpec.groupBy.label}`,
      `| summarize count = count() by ${parseSpec.groupBy.field}\n| sort by count desc\n| limit 20`,
      { x: 0, y: 0, w: 12, h: 6 }),
    el('element_recent_events', 'list.events', 'Recent events',
      `${projectClause}| limit 100`,
      { x: 0, y: 6, w: 12, h: 8 }),
  ];
}

/**
 * Short, source-specific label for the saved search + dashboard names — e.g.
 * "Firewall Traffic SE Demo" rather than the use case's own title, since one
 * use case (Tiered Retention, Lakehouse Engine Routing, ...) can run over any
 * of several different sources and they'd otherwise all share one identical
 * dashboard name. Falls back to `fallbackTitle` (the use case title) for any
 * sample without a clean topic name of its own.
 */
function dashboardTopicForSample(datagenSample: string, fallbackTitle: string): string {
  switch (datagenSample) {
    case 'palo_alto_traffic':
    case 'generic_tcp_policy':
      return 'Firewall Traffic';
    case 'sentinel_windowsevents':
      return 'Windows Logs';
    case 'linux_syslog':
      return 'Linux Syslog';
    case 'cisco_asa':
      return 'Cisco ASA Firewall';
    case 'checkpoint_fw':
      return 'Check Point Firewall';
    case 'crowdstrike_falcon':
      return 'CrowdStrike Detections';
    case 'f5_bigip':
      return 'F5 BIG-IP';
    case 'zscaler_nss':
      return 'Zscaler Web Traffic';
    case OTEL_SAMPLE:
      return 'AI Telemetry';
    default:
      return fallbackTitle;
  }
}

/**
 * Build the Cribl Search artifacts for a scenario:
 *  - a "search copy" output that forks the feed into the Lake dataset
 *  - a saved search and a dashboard that query that dataset
 */
function buildSearchArtifacts(
  token: string,
  title: string,
  datasetId: string,
  streamtags: string[],
  datagenSample: string,
): {
  searchCopyObject: CriblObjectSpec;
  savedSearchSpec: CriblObjectSpec;
  dashboardSpecs: CriblObjectSpec[];
} {
  const searchCopyObject: CriblObjectSpec = {
    kind: 'output',
    id: `demo_dst_${token}_lake`,
    role: 'destination',
    hidden: false,
    label: 'Cribl Lake (searchable)',
    config: {
      type: 'cribl_lake',
      destPath: datasetId,
      stagePath: LAKE_STAGE_PATH,
      awsAuthenticationMethod: 'auto',
      compress: 'gzip',
      streamtags,
      description: `Cribl Lake dataset ${datasetId} (backs Cribl Search)`,
    },
  };

  const parseSpec = searchParseForSample(datagenSample);
  const parseClause = parseSpec.parse ? `\n${parseSpec.parse}` : '';
  const projectClause = parseSpec.projectFields.length
    ? `\n| project ${parseSpec.projectFields.join(', ')}`
    : '';
  const eventsQuery = `dataset="${datasetId}"${parseClause}${projectClause}\n| limit 100`;

  const topic = dashboardTopicForSample(datagenSample, title);

  const savedSearchSpec: CriblObjectSpec = {
    kind: 'saved-search',
    id: `demo_saved_${token}`,
    role: 'saved-search',
    hidden: false,
    label: `${topic} — recent events`,
    config: {
      name: sanitizeSearchName(`${topic} recent events`),
      description: `SE Demo Launcher saved search over the Cribl Lake dataset ${datasetId} (${title}).`,
      query: eventsQuery,
      earliest: '-60m',
      latest: 'now',
    },
  };

  // One source-aware dashboard per scenario, named after the source/topic
  // (not the use case) — several use cases run over any of several sources,
  // and they'd otherwise all produce an identically-named dashboard. (The AI
  // Observability use case doesn't wire this into its plan at all — the
  // real, installed app supplies its own UI — see the `enrichAllFeeds`
  // branch below.)
  const dashboardSpecs: CriblObjectSpec[] = [
    {
      kind: 'dashboard',
      id: `demo_dash_${token}`,
      role: 'dashboard',
      hidden: false,
      label: `${topic} — SE Demo dashboard`,
      config: {
        name: sanitizeSearchName(`${topic} SE Demo`),
        description: `SE Demo Launcher dashboard over ${datasetId} (${title}).`,
        // Source-aware panels (chart + list visualizations) modeled on the
        // Cribl Search content packs. Each element carries id + layout +
        // search + type so it validates against the SearchDashboard schema;
        // charts infer axes from the summarized result columns.
        elements: buildDashboardElements(datasetId, parseSpec, datagenSample),
      },
    },
  ];

  return { searchCopyObject, savedSearchSpec, dashboardSpecs };
}

/**
 * Deployment planner. Produces the concrete QuickConnect object graph:
 *
 *   datagen (hidden) ──▶ loop output (hidden) ──▶ visible listener source ──▶ destination(s)
 *
 * This encodes the product rule in real Cribl objects: datagen is used under the
 * hood, but the events arrive through a genuine syslog/TCP listener that the SE
 * presents as the source. Destinations are created (not necessarily live) so the
 * SE can show the full path.
 */
/** Deterministic 32-bit seed from the scenario token so content is stable. */
function seedFromToken(token: string): number {
  let h = 2166136261;
  for (let i = 0; i < token.length; i += 1) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Deterministic port for this scenario's Local Search ingest listener on the
 * Lakehouse engine's own host, derived from the token so redeploying the same
 * scenario is idempotent and concurrent demos targeting the same engine don't
 * collide.
 *
 * Cribl.Cloud only opens a fixed 20000-20010 range (plus a short list of
 * preconfigured ports, e.g. the built-in Local Search HTTP listener on
 * 10200) for custom ingest on Cribl-managed Workers — anything outside it is
 * firewalled, full stop. An earlier version of this picked an arbitrary port
 * in 24000-24999, which is NOT in that range: the resulting `cribl_search_engine`
 * output could never open a TCP connection to it (`connect ETIMEDOUT`), so
 * every Lakehouse Engine Routing deploy silently failed to ever land data.
 * 20000-20010 is also clear of the per-source Stream listener ports (21014+
 * in `sourceProfiles.ts`), so no collision there either.
 */
function lakehousePortFromToken(token: string): number {
  return 20000 + (seedFromToken(token) % 11);
}

/** Random hex ingest token (fresh per deploy, stored in KV, injected by proxy). */
function randomIngestToken(): string {
  const bytes = new Uint8Array(24);
  (globalThis.crypto ?? ({} as Crypto)).getRandomValues?.(bytes);
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out || `da_${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
}

interface SecurityRefs {
  useCase: UseCaseTemplate;
  runMode: RunMode;
  source: SourceProfile;
  presentation: PresentationMode;
  processing: ProcessingProfile;
}

/**
 * Build the historical-backfill deployment plan for the AI Investigator security
 * demo. Creates one Cribl Lake dataset per correlated source, ensures a Direct
 * Access HTTP Source with a fresh ingest token, backfills backdated NDJSON into
 * each dataset, and tags the federated Search entries for investigator discovery.
 */
function buildSecurityBackfillPlan(
  selection: ScenarioSelection,
  refs: SecurityRefs,
): DeploymentPlan {
  const { useCase, runMode, source, presentation, processing } = refs;
  const token = scenarioToken(selection);
  const seed = seedFromToken(token);
  const anchorSec = Math.floor(Date.now() / 1000);
  const ingestToken = randomIngestToken();
  const scenarioTag = `demo-${token}`;
  const streamtags = [DEMO_TAG, scenarioTag];

  // Resolve the fixed destination (Cribl Lake) for storytelling/rendering.
  const destinations = selection.destinationIds
    .map((id) => destinationProfileById.get(id))
    .filter((d): d is DestinationProfile => Boolean(d));
  const visualOutcomes = selection.visualOutcomeIds
    .map((id) => visualOutcomeProfileById.get(id))
    .filter((v): v is NonNullable<typeof v> => Boolean(v));

  // Sanity: build the incident once so we can surface real event counts on the
  // review screen (and confirm the generators run cleanly).
  const incident = buildIncidentData(seed, SECURITY_WINDOW_HOURS, anchorSec);

  // Authentic, operational-looking Lake dataset ids (NOT demo-prefixed) so the
  // AI Investigator treats them as genuine telemetry archives.
  const feedDatasetId = (feed: (typeof SECURITY_FEEDS)[number]) => SECURITY_DATASET_ID[feed];

  const datasetObjects: CriblObjectSpec[] = SECURITY_FEEDS.map((feed) => {
    const meta = SECURITY_DATASET_META[feed];
    return {
      kind: 'lake-dataset',
      id: feedDatasetId(feed),
      role: 'search-dataset',
      hidden: false,
      label: `${meta.title} — ${feedDatasetId(feed)}`,
      config: {
        description: meta.description,
        retentionPeriodInDays: 30,
        format: 'json',
        searchConfig: { searchVersion: 'v1' },
        // Associate the dataset with Direct Access HTTP ingest up front so the SE
        // never has to "add the dataset to the Direct Access source" by hand in
        // the UI — the backfill can POST straight to /datasets/<id>.
        httpDAUsed: true,
      },
    };
  });

  const actions: DeploymentAction[] = [];

  // 1) Create the Lake datasets.
  for (const obj of datasetObjects) {
    actions.push({
      id: nextId('act'),
      kind: 'create-search-dataset',
      label: `Create Cribl Lake dataset — ${obj.id}`,
      detail: `Federated, searchable Lake dataset ${obj.id} in the ${LAKE_ID} Lake.`,
      implementation: 'live',
      op: { type: 'create-lake-dataset', lakeId: LAKE_ID, objectId: obj.id, config: obj.config },
    });
  }

  // 2) Store the ingest token in KV (proxies.yml injects it as Authorization).
  actions.push({
    id: nextId('act'),
    kind: 'seed-sample-feed',
    label: 'Provision Lake ingest token',
    detail: `Stored in this app's KV store (${LAKE_INGEST_TOKEN_KV_KEY}) for Direct Access ingest.`,
    implementation: 'live',
    op: { type: 'put-ingest-token', key: LAKE_INGEST_TOKEN_KV_KEY, token: ingestToken },
  });

  // 3) Ensure the Direct Access HTTP Source exists (with our token).
  actions.push({
    id: nextId('act'),
    kind: 'create-source',
    label: 'Enable Cribl Lake Direct Access (HTTP)',
    detail: `Direct Access HTTP Source "${LAKE_DIRECT_ACCESS_ID}" on the ${LAKE_ID} Lake for NDJSON ingest.`,
    implementation: 'live',
    op: {
      type: 'ensure-direct-access',
      lakeId: LAKE_ID,
      sourceId: LAKE_DIRECT_ACCESS_ID,
      token: ingestToken,
    },
  });

  // 4) Backfill each dataset with backdated events.
  for (const feed of SECURITY_FEEDS) {
    const id = feedDatasetId(feed);
    const count = incident.feeds[feed].length;
    actions.push({
      id: nextId('act'),
      kind: 'backfill-data',
      label: `Backfill ${feed} events — ${id}`,
      detail: `POST ~${count.toLocaleString()} backdated ${feed} events (last ${SECURITY_WINDOW_DAYS} days) into ${id}.`,
      implementation: 'live',
      op: {
        type: 'backfill-dataset',
        lakeId: LAKE_ID,
        sourceId: LAKE_DIRECT_ACCESS_ID,
        objectId: id,
        feed,
        seed,
        windowHours: SECURITY_WINDOW_HOURS,
        anchorSec,
      },
    });
  }

  // 5) Tag the federated Search datasets for investigator discovery (best-effort).
  for (const feed of SECURITY_FEEDS) {
    const meta = SECURITY_DATASET_META[feed];
    const id = feedDatasetId(feed);
    actions.push({
      id: nextId('act'),
      kind: 'create-search-dataset',
      label: `Tag federated dataset — ${id}`,
      detail: `Attach description + tags (${meta.tags.join(', ')}) so the AI Investigator discovers ${id}.`,
      implementation: 'live',
      op: {
        type: 'tag-federated-dataset',
        objectId: id,
        description: meta.description,
        tags: meta.tags,
      },
    });
  }

  const route: RouteStep[] = SECURITY_FEEDS.map((feed) => ({
    from: SECURITY_DATASET_META[feed].title,
    to: 'Cribl Lake (federated Search)',
    condition: `backdated ${feed} events`,
  }));

  const totalEvents = SECURITY_FEEDS.reduce((n, f) => n + incident.feeds[f].length, 0);

  return {
    id: nextId('plan'),
    createdAt: new Date().toISOString(),
    selection,
    useCase,
    runMode,
    source,
    presentation,
    destinations,
    processing,
    overlays: [],
    visualOutcomes,
    groupId: selection.groupId,
    routingMechanism: 'quickconnect',
    streamtags,
    criblObjects: datasetObjects,
    readiness: 'full',
    sourcePresentation: {
      displayName: source.displayName,
      listener: presentation.listenerType,
      endpoint: `Cribl Lake Direct Access (HTTP) → ${SECURITY_FEEDS.length} datasets`,
    },
    dataPath: {
      internalGeneration: {
        method: source.sampleFeed.method,
        templateRef: source.sampleFeed.internalTemplateRef,
        approxEventsPerSecond: source.sampleFeed.approxEventsPerSecond,
      },
      visibleSource: { displayName: source.displayName, protocol: source.protocol },
      streamListener: {
        inputKind: source.streamInputKind,
        displayName: source.displayName,
        protocol: source.protocol,
        host: '0.0.0.0',
        port: source.defaultPort,
      },
      postIngest: {
        routeSummary: `~${totalEvents.toLocaleString()} backdated events across ${SECURITY_FEEDS.length} correlated Cribl Lake datasets`,
        pipelineSummary: `${processing.displayName}: ${processing.steps.join(' → ')}`,
      },
    },
    route,
    actions,
    estimatedActionCount: actions.length,
  };
}

export function buildDeploymentPlan(
  selection: ScenarioSelection,
  preflight?: PreflightResult,
): DeploymentPlan {
  const useCase = useCaseTemplateById.get(selection.useCaseId);
  const runMode = runModeById.get(selection.runMode);
  // An SE-uploaded sample (see domain/samples/customUpload.ts) is carried
  // directly on the selection rather than looked up from the static registry.
  const source = selection.customSource ?? sourceProfileById.get(selection.sourceProfileId);
  const presentation = presentationModeById.get(selection.presentationModeId);
  const processing = processingProfileById.get(selection.processingId);

  if (!useCase || !runMode || !source || !presentation || !processing) {
    throw new Error('Invalid selection: could not resolve one or more references.');
  }

  // Historical-backfill path: no live QuickConnect feed. Instead we author a
  // correlated, backdated security incident and write it straight into Cribl Lake
  // datasets via Direct Access HTTP ingest, then expose them as federated Search
  // datasets for the AI Investigator.
  if (useCase.id === AI_SECURITY_USE_CASE) {
    return buildSecurityBackfillPlan(selection, {
      useCase,
      runMode,
      source,
      presentation,
      processing,
    });
  }

  const overlays = selection.overlayIds
    .map((id) => policyOverlayById.get(id))
    .filter((o): o is NonNullable<typeof o> => Boolean(o));

  const { destinations, readiness } = resolveDestinations(selection, preflight);

  const visualOutcomes = selection.visualOutcomeIds
    .map((id) => visualOutcomeProfileById.get(id))
    .filter((v): v is NonNullable<typeof v> => Boolean(v));

  // Lakehouse Engine Routing has no DestinationProfile tiles either — the
  // "destination" is the SE-picked engine, collected via `engineId` (see the
  // wizard's destination-step engine picker). (Can't reference
  // `enrichAllFeeds` here — it's declared further down — so both special
  // cases are checked inline.)
  const routeToLakehouseEngine = useCase.id === LAKEHOUSE_ENGINE_USE_CASE;

  const listener = presentation.listenerType;
  const endpoint = `0.0.0.0:${source.defaultPort} (${source.loopListenerKind.toUpperCase()})`;
  const route = routeToLakehouseEngine
    ? [
        {
          from: source.displayName,
          to: `Lakehouse engine (${selection.engineId ?? 'engine not set'})`,
          condition: 'native Lakehouse ingest',
        },
      ]
    : processing.pipelineTemplate === 'otel-enrich'
      ? [
          {
            from: source.displayName,
            to: `AI Observability app's OTLP listener (${(selection.otelIngestHost ?? '').trim() || 'host not set'})`,
            condition: 'genuine Claude Code OTLP, logs + metrics',
          },
        ]
      : buildRoute(source.displayName, destinations);

  const overlayPipelineSteps = overlays.flatMap((o) => o.pipelineAdditions);
  const overlayRouteNotes = overlays.flatMap((o) => o.routeAdditions);
  const effectivePipelineSteps = [...processing.steps, ...overlayPipelineSteps];

  // ---- Concrete Cribl object graph (QuickConnect) ----
  const token = scenarioToken(selection);
  const genId = `demo_gen_${token}`;
  const loopId = `demo_loop_${token}`;
  const srcId = `demo_src_${token}`;
  const pipeId = `demo_pipe_${token}`;

  // Stream tags: a global demo tag + a per-scenario tag so the SE can filter
  // QuickConnect to all demo assets, or just this scenario's assets. Only the
  // VISIBLE objects (the source + destinations) are tagged — the datagen and
  // loop plumbing stay untagged so they never show up in the filtered view.
  const scenarioTag = `demo-${token}`;
  const streamtags = [DEMO_TAG, scenarioTag];

  // AI Observability path: the enrichment pipeline runs on EVERY feed (no SIEM
  // split) and sends straight to the real app's own OTLP/HTTP listener — no
  // Lake/Search dataset of ours to create, so there's no `datasetObject` for
  // this path at all.
  const enrichAllFeeds = processing.pipelineTemplate === 'otel-enrich';

  // Dataset backing the saved search + dashboard for every OTHER scenario
  // (demo-scoped, so each demo owns its data rather than sharing
  // `default_logs`). Computed unconditionally for simplicity, but unused by
  // the AI Observability path (see above).
  const datasetId = demoDatasetId(token);
  // Federated (Lake) path uses search execution v1. The Lake stores events as
  // Cribl-JSON (each object carries `_raw` + envelope fields).
  //
  // NOTE: We intentionally do NOT set a breaker ruleset / datatype on the dataset
  // here — the Lake dataset create API rejects `breakerRulesets` as an additional
  // property. For Palo Alto, apply the "Palo Alto Datatypes" ruleset MANUALLY on
  // the dataset after creation (Search → Datasets → the demo dataset). Once
  // applied, events parse into named fields (source_ip, destination_ip,
  // application, action, bytes; datatype `pan_traffic`), which is what the Palo
  // dashboards below query.
  const searchConfig: Record<string, unknown> = { searchVersion: 'v1' };
  const datasetObject: CriblObjectSpec | undefined =
    enrichAllFeeds || routeToLakehouseEngine
      ? undefined
      : {
          kind: 'lake-dataset',
          id: datasetId,
          role: 'search-dataset',
          hidden: false,
          label: `Cribl Search dataset (${datasetId})`,
          config: {
            description: `SE Demo Launcher dataset for ${useCase.title}`,
            retentionPeriodInDays: 30,
            format: 'json',
            searchConfig,
          },
        };

  // Lakehouse Engine Routing: a dataset tied directly to the SE-picked engine
  // (no federated Lake dataset at all — see `datasetObject` above), plus the
  // internal Local Search ingest listener the Stream destination below sends
  // to, and the port they share.
  const lakehousePort = lakehousePortFromToken(token);
  const searchSourceId = `demo_search_src_${token}`;
  const lakehouseDatasetObject: CriblObjectSpec | undefined = routeToLakehouseEngine
    ? {
        kind: 'lakehouse-dataset',
        id: datasetId,
        role: 'search-dataset',
        hidden: false,
        label: `Lakehouse dataset (${datasetId})`,
        config: {
          description: `SE Demo Launcher Lakehouse dataset for ${useCase.title}, tied to engine ${
            selection.engineId ?? '(not set)'
          }.`,
          // The live `cribl_search` dataset schema requires this (not present
          // in our bundled openapi.json, which is stale for this type — the
          // Federated Lake dataset's own field is the differently-named
          // `retentionPeriodInDays`). 30 days matches that dataset's value;
          // if the live API rejects the type/format, its error will say so.
          retentionPeriod: 30,
        },
      }
    : undefined;
  const searchSourceObject: CriblObjectSpec | undefined = routeToLakehouseEngine
    ? {
        kind: 'search-source',
        id: searchSourceId,
        role: 'search-source',
        hidden: true,
        label: 'Lakehouse ingest listener (internal)',
        config: {
          type: 'cribl_http',
          port: lakehousePort,
          description: `Internal Local Search ingest for ${useCase.title}`,
        },
      }
    : undefined;

  // Search tier: a saved search + dashboard over the dedicated dataset, plus a
  // passthrough Lake feed used only when no Lake destination is selected. Not
  // used by the AI Observability path (the real app supplies its own UI) —
  // computed unconditionally for simplicity, but its output is only spread
  // into `criblObjects` below when `!enrichAllFeeds`.
  const { searchCopyObject, savedSearchSpec, dashboardSpecs } = buildSearchArtifacts(
    token,
    useCase.title,
    datasetId,
    streamtags,
    source.datagenSample,
  );

  // Processing on the SIEM feed. The pack follows the DATA: whichever source
  // (datagen sample) the SE chose, its matching Cribl Pack is installed and the
  // SIEM connection is routed through `pack:<id>` (idiomatic pack usage). Custom
  // pipeline profiles opt out of packs and get a self-contained demo pipeline.
  // Lakehouse Engine Routing has no SIEM feed to apply a pack/pipeline to —
  // events are parsed search-side instead (see `searchParseForSample`).
  const pack =
    processing.kind === 'custom-pipeline' || routeToLakehouseEngine
      ? undefined
      : (packForDatagenSample(source.datagenSample) ?? processing.pack);
  const packRefPipeline = pack ? `pack:${pack.id}` : undefined;
  const siemPipeline = packRefPipeline ?? pipeId;

  const packObject: CriblObjectSpec | undefined = pack
    ? {
        kind: 'pack',
        id: pack.id,
        role: 'pack',
        hidden: false,
        label: `${processing.displayName} (${pack.id})`,
        config: { source: pack.source },
      }
    : undefined;

  const pipelineObject: CriblObjectSpec | undefined = pack || routeToLakehouseEngine
    ? undefined
    : {
        kind: 'pipeline',
        id: pipeId,
        role: 'pipeline',
        hidden: false,
        label: `${processing.displayName} pipeline`,
        config: enrichAllFeeds
          ? buildOtelEnrichPipelineConf(streamtags)
          : buildPipelineConf(processing, streamtags),
      };

  // Build destination outputs + their QuickConnect connections together. Every
  // Cribl Lake destination writes to the SAME dedicated demo dataset, and
  // multiple Lake destinations collapse into a SINGLE Lake output (one Lake
  // feed, deduped). SIEM feeds get the Pack/pipeline; everything else is
  // passthrough.
  const destObjects: CriblObjectSpec[] = [];
  const connections: Array<{ output: string; pipeline?: string }> = [];
  // Demo-scoped id for the AI path's destination — safe for reset to sweep
  // by its `demo_` prefix without touching anything platform-provided.
  const aiLogsDestId = `demo_dst_${token}_otlp_logs`;
  const lakehouseOutputId = `demo_dst_${token}_search_engine`;
  if (routeToLakehouseEngine) {
    // Native Lakehouse ingest: the Stream listener QuickConnects straight to
    // a `cribl_search_engine` output pointed at the SE-picked engine's own
    // ingest host, on the same port as the Local Search source above. No
    // Lake/federated-Search dataset of ours — see `lakehouseDatasetObject`.
    const engineId = selection.engineId ?? '';
    destObjects.push({
      kind: 'search-output',
      id: lakehouseOutputId,
      role: 'destination',
      hidden: false,
      label: `Lakehouse engine ingest (${engineId || 'engine not set'})`,
      config: {
        type: 'cribl_search_engine',
        streamtags,
        description: `SE Demo Launcher → Lakehouse engine ${engineId || '(not set)'} ingest`,
      },
    });
    connections.push({ output: lakehouseOutputId });
  } else if (enrichAllFeeds) {
    // AI path: send genuine Claude Code OTLP straight to the real app's own
    // OTLP/HTTP listener (SE-provided host:port — see `otelIngestHost` on
    // ScenarioSelection). The pipeline builds the full OTLP logs envelope per
    // event (see buildOtelEnrichPipelineConf below); the destination just
    // forwards that field verbatim as the request body. We never write
    // into a Lake/Search dataset ourselves — the app's own ingestion pack
    // normalizes and lands the data. No separate metrics destination: read
    // live from the real app's own normalizer pipeline that a standalone
    // OTLP metrics payload is unconditionally rejected, and that Usage &
    // Cost is derived from this SAME logs event anyway (see the doc comment
    // on buildOtelEnrichPipelineConf).
    const otlpHost = (selection.otelIngestHost ?? '').trim();
    destObjects.push({
      kind: 'output',
      id: aiLogsDestId,
      role: 'destination',
      hidden: false,
      label: `AI Observability app — OTLP/HTTP logs (${otlpHost || 'host not set'})`,
      config: {
        type: 'webhook',
        url: `https://${otlpHost}/v1/logs`,
        method: 'POST',
        format: 'custom',
        // A bare JS expression (Cribl validates this with a jsExpression
        // check) — NOT the `${...}` template syntax customPayloadExpression
        // uses elsewhere; that wrapper is itself invalid JS and fails to
        // parse ("Unexpected token '{'"), confirmed live.
        customSourceExpression: '_otlpLogsEnvelope',
        customContentType: 'application/json',
        customDropWhenNull: true,
        authType: 'none',
        streamtags,
        description: "SE Demo Launcher → real AI Observability app's OTLP/HTTP logs listener",
      },
    });
    connections.push({ output: aiLogsDestId, pipeline: pipeId });
  } else {
    let lakeOutputId: string | undefined;
    for (const dest of destinations) {
      const isLake = dest.criblOutput.type === 'cribl_lake';
      // Second (and later) Lake destinations fold into the single Lake feed.
      if (isLake && lakeOutputId) continue;

      const id = isLake
        ? `demo_dst_${token}_lake`
        : `demo_dst_${token}_${shortId(dest.id)}`;
      const config: Record<string, unknown> = {
        ...dest.criblOutput.config,
        type: dest.criblOutput.type,
        streamtags,
        description:
          (dest.criblOutput.config.description as string | undefined) ??
          dest.displayName,
      };
      if (isLake) {
        config.destPath = datasetId;
        lakeOutputId = id;
      }
      destObjects.push({
        kind: 'output',
        id,
        role: 'destination',
        hidden: false,
        label: isLake ? 'Cribl Lake (searchable)' : dest.displayName,
        config,
      });
      const conn: { output: string; pipeline?: string } = { output: id };
      if (dest.role === 'siem-analytics') conn.pipeline = siemPipeline;
      connections.push(conn);
    }

    // A single Cribl Lake dataset always backs Search. If the SE selected a Lake
    // destination, that output IS the searchable feed. Otherwise add ONE
    // passthrough Lake feed (no Pack/pipeline) into the demo dataset so the saved
    // search + dashboard have data.
    if (!lakeOutputId) {
      destObjects.push(searchCopyObject);
      connections.push({ output: searchCopyObject.id });
    }
  }

  const loopObject: CriblObjectSpec = {
    kind: 'output',
    id: loopId,
    role: 'loop',
    hidden: true,
    label: 'Internal loop',
    config: buildLoopOutput(source),
  };

  const sourceObject: CriblObjectSpec = {
    kind: 'input',
    id: srcId,
    role: 'source',
    hidden: false,
    label: source.displayName,
    config: buildSourceInput(source, connections, streamtags),
  };

  // Replay sources ship their own events (e.g. Windows XML) and can't rely on a
  // Cribl datagen template. For them, the datagen is only a clock feeding a
  // replay pipeline that injects our events; other sources use the datagen's own
  // built-in sample directly.
  const replay = source.replaySample;
  const injectId = `demo_inject_${token}`;
  const injectObject: CriblObjectSpec | undefined = replay
    ? {
        kind: 'pipeline',
        id: injectId,
        role: 'pipeline',
        hidden: true,
        label: 'Replay source data (internal)',
        config: buildReplayPipelineConf(replay),
      }
    : undefined;

  const datagenObject: CriblObjectSpec = {
    kind: 'input',
    id: genId,
    role: 'datagen',
    hidden: true,
    label: 'Sample event engine (internal)',
    config: {
      type: 'datagen',
      sendToRoutes: false,
      samples: [
        {
          sample: replay ? REPLAY_HEARTBEAT_SAMPLE : source.datagenSample,
          eventsPerSec: DEFAULT_EPS,
        },
      ],
      // For replay sources, run each generated tick through the replay pipeline
      // (which overwrites `_raw` with our event) before it hits the loop.
      connections: [replay ? { output: loopId, pipeline: injectId } : { output: loopId }],
      description: `Internal feed for ${source.displayName}`,
      disabled: false,
    },
  };

  // Create order matters: create the Lake dataset first (the Lake output's
  // destPath references it), then the pack (the SIEM + search connections
  // reference it), then destinations + optional pipeline (referenced by the
  // source's connections), then the loop output, the source, and datagen
  // (references the loop). Saved search + dashboard come last (they query the
  // Lake dataset the feed writes into) — not built at all for the AI
  // Observability path, which relies on the real app's own UI instead.
  const criblObjects: CriblObjectSpec[] = [
    ...(datasetObject ? [datasetObject] : []),
    ...(lakehouseDatasetObject ? [lakehouseDatasetObject] : []),
    ...(searchSourceObject ? [searchSourceObject] : []),
    ...(packObject ? [packObject] : []),
    ...destObjects,
    ...(pipelineObject ? [pipelineObject] : []),
    ...(injectObject ? [injectObject] : []),
    loopObject,
    sourceObject,
    datagenObject,
    ...(enrichAllFeeds ? [] : [savedSearchSpec, ...dashboardSpecs]),
  ];

  // ---- Human-facing actions, each backed by a concrete API op ----
  const siemNames = destinations
    .filter((d) => d.role === 'siem-analytics')
    .map((d) => d.displayName)
    .join(', ');
  const actions: DeploymentAction[] = [];
  for (const obj of criblObjects) {
    let op: DeploymentOp;
    let kind: DeploymentAction['kind'];
    let label: string;
    let detail: string;
    switch (obj.kind) {
      case 'lake-dataset':
        // Only ever a demo-scoped federated Lake dataset now — the AI
        // Observability path has no `lake-dataset` object at all (it sends
        // straight to the real app's OTLP listener, nothing to create).
        op = {
          type: 'create-lake-dataset',
          lakeId: LAKE_ID,
          objectId: obj.id,
          config: obj.config,
        };
        kind = 'create-search-dataset';
        label = `Create Cribl Search dataset — ${obj.id}`;
        detail = `Cribl Lake dataset ${obj.id} in the ${LAKE_ID} Lake, searchable in Cribl Search.`;
        break;
      case 'lakehouse-dataset':
        op = {
          type: 'create-lakehouse-dataset',
          objectId: obj.id,
          engineId: selection.engineId ?? '',
          config: obj.config,
        };
        kind = 'create-search-dataset';
        label = `Create Lakehouse dataset — ${obj.id}`;
        detail = `Cribl Search Lakehouse dataset ${obj.id}, tied to engine ${
          selection.engineId ?? '(not set)'
        }.`;
        break;
      case 'search-source':
        op = {
          type: 'create-search-source',
          objectId: obj.id,
          port: Number(obj.config.port),
          config: obj.config,
        };
        kind = 'create-source';
        label = `Create Lakehouse ingest listener — ${obj.id}`;
        detail = 'Internal Local Search ingest source on the Lakehouse engine.';
        break;
      case 'search-output':
        op = {
          type: 'create-search-output',
          objectId: obj.id,
          port: lakehousePort,
          config: obj.config,
        };
        kind = 'connect-destination';
        label = `Create destination — ${obj.label}`;
        detail = `Cribl object ${obj.id} (${String(obj.config.type)}), routed to the Lakehouse engine's ingest host.`;
        break;
      case 'pack':
        op = { type: 'install-pack', objectId: obj.id, source: String(obj.config.source) };
        kind = 'apply-pack';
        label = `Install Cribl Pack — ${obj.id}`;
        detail = `Installed into ${selection.groupId} and applied to the ${
          siemNames || 'SIEM'
        } feed (pack:${obj.id}).`;
        break;
      case 'pipeline':
        op = { type: 'create-pipeline', objectId: obj.id, conf: obj.config };
        kind = 'apply-pipeline';
        if (obj.hidden) {
          // Internal replay pipeline that shapes generated ticks into our events.
          label = `Prepare ${source.displayName} data`;
          detail = `Cribl pipeline ${obj.id} replays the ${source.displayName} sample set.`;
        } else {
          label = `Create processing pipeline — ${processing.displayName}`;
          detail = `Applied to the ${siemNames || 'SIEM'} feed on its QuickConnect connection.`;
        }
        break;
      case 'saved-search':
        op = { type: 'create-saved-search', objectId: obj.id, config: obj.config };
        kind = 'create-saved-search';
        label = `Create saved search — ${obj.label}`;
        detail = 'Saved search in default_search over the federated dataset.';
        break;
      case 'dashboard':
        op = { type: 'create-dashboard', objectId: obj.id, config: obj.config };
        kind = 'create-dashboard';
        label = `Create dashboard — ${obj.label}`;
        detail = `Cribl Search dashboard in default_search, with panels matched to ${source.displayName} (volume/activity over time, allow-deny or severity split, top talkers, recent events with source-specific fields).`;
        break;
      case 'output':
        op = { type: 'create-output', objectId: obj.id, config: obj.config };
        kind = 'connect-destination';
        label = `Create destination — ${obj.label}`;
        detail = `Cribl object ${obj.id} (${String(obj.config.type)}).`;
        break;
      default:
        op = { type: 'create-input', objectId: obj.id, config: obj.config };
        if (obj.role === 'datagen') {
          kind = 'seed-sample-feed';
          label = `Prime ${source.displayName} feed`;
          detail = `Cribl object ${obj.id} (${String(obj.config.type)}).`;
        } else if (obj.role === 'loop') {
          kind = 'enable-route';
          label = `Wire feed into ${listener}`;
          detail = `Cribl object ${obj.id} (${String(obj.config.type)}).`;
        } else {
          kind = 'create-source';
          label = `Create ${source.displayName} (${listener})`;
          detail = `QuickConnect ${source.displayName} → ${destinations
            .map((d) => d.displayName)
            .join(', ')}, plus federated Search copy.`;
        }
    }
    actions.push({ id: nextId('act'), kind, label, detail, implementation: 'live', op });
  }

  // Federated Search / Lake path: best-effort native datatyping, same as the
  // Lakehouse engine path below. The Lake dataset create API rejects
  // `breakerRulesets` as an additional property, so it can't be set at
  // creation time (see `datasetObject` above) — bind it via a separate PATCH
  // instead, once the dataset exists. Binds a known breaker ruleset
  // (currently just Palo Alto's "Palo Alto Datatypes") so dashboards and
  // saved searches see real fields instead of unparsed `_raw`. Without this,
  // `searchParseForSample`'s empty parse clause for Palo Alto has nothing to
  // fall back on and every panel comes back empty.
  if (datasetObject) {
    const lakeBreakerRuleset = breakerRulesetForDatagenSample(source.datagenSample);
    if (lakeBreakerRuleset) {
      actions.push({
        id: nextId('act'),
        kind: 'create-search-dataset',
        label: `Apply datatype — ${lakeBreakerRuleset}`,
        detail: `Binds the "${lakeBreakerRuleset}" breaker ruleset to ${datasetId} so events land pre-parsed, not just raw _raw.`,
        implementation: 'live',
        op: { type: 'apply-datatype', objectId: datasetId, breakerRuleset: lakeBreakerRuleset },
      });
    }
  }

  // Lakehouse Engine Routing: the engine drops events that don't match an
  // existing dataset-ruleset rule, so this is what actually lands data in our
  // dataset — not object-backed, so it's appended directly rather than going
  // through the criblObjects loop above.
  if (routeToLakehouseEngine) {
    // Best-effort native datatyping: when a known breaker ruleset matches
    // this source's data (currently just Palo Alto's "Palo Alto Datatypes"),
    // bind it so events are classified/parsed as a real datatype on write,
    // not just at search time. Every source still gets search-time parsing
    // via `searchParseForSample` regardless (see the dashboard/saved search
    // queries below) — this is additive, and never blocks the deploy if the
    // ruleset doesn't apply cleanly to the Lakehouse dataset API.
    const lakehouseBreakerRuleset = breakerRulesetForDatagenSample(source.datagenSample);
    if (lakehouseBreakerRuleset) {
      actions.push({
        id: nextId('act'),
        kind: 'create-search-dataset',
        label: `Apply datatype — ${lakehouseBreakerRuleset}`,
        detail: `Binds the "${lakehouseBreakerRuleset}" breaker ruleset to ${datasetId} so events land pre-parsed, not just raw _raw.`,
        implementation: 'live',
        op: { type: 'apply-datatype', objectId: datasetId, breakerRuleset: lakehouseBreakerRuleset },
      });
    }

    actions.push({
      id: nextId('act'),
      kind: 'accelerate-dataset',
      label: `Route engine ingest → ${datasetId}`,
      detail: `Dataset-ruleset rule on engine ${
        selection.engineId ?? '(not set)'
      } matching this run's ingest source, sending to ${datasetId}.`,
      implementation: 'live',
      op: {
        type: 'route-dataset',
        engineId: selection.engineId ?? '',
        datasetId,
        sourceId: searchSourceId,
      },
    });
  }

  actions.push({
    id: nextId('act'),
    kind: 'enable-visual-asset',
    label: `Commit & deploy to ${selection.groupId}`,
    detail: 'Commit the group config and deploy so the source and QuickConnect take effect.',
    implementation: 'live',
    op: { type: 'commit-deploy' },
  });

  return {
    id: nextId('plan'),
    createdAt: new Date().toISOString(),
    selection,
    useCase,
    runMode,
    source,
    presentation,
    destinations,
    processing,
    overlays,
    visualOutcomes,
    groupId: selection.groupId,
    routingMechanism: 'quickconnect',
    streamtags,
    criblObjects,
    readiness: preflight ? preflight.readiness : readiness,
    fallbackNote: preflight?.fallbackNote,
    sourcePresentation: {
      displayName: source.displayName,
      listener,
      endpoint,
    },
    dataPath: {
      internalGeneration: {
        method: source.sampleFeed.method,
        templateRef: source.sampleFeed.internalTemplateRef,
        approxEventsPerSecond: source.sampleFeed.approxEventsPerSecond,
      },
      visibleSource: {
        displayName: source.displayName,
        protocol: source.protocol,
      },
      streamListener: {
        inputKind: source.streamInputKind,
        displayName: source.displayName,
        protocol: source.protocol,
        host: '0.0.0.0',
        port: source.defaultPort,
      },
      postIngest: {
        routeSummary: [
          ...route.map((r) => `${r.condition ?? 'events'} → ${r.to}`),
          ...overlayRouteNotes,
        ].join('; '),
        pipelineSummary: routeToLakehouseEngine
          ? 'No Stream-side pipeline — events are parsed search-side in the Lakehouse dataset.'
          : `${processing.displayName}: ${effectivePipelineSteps.join(' → ')}`,
      },
    },
    route,
    actions,
    estimatedActionCount: actions.length,
  };
}
