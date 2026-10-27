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
  DEFAULT_SEARCH_ENGINE_ID,
  FALLBACK_DESTINATION_IDS,
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
import { subjectKeywords } from '../domain/samples/claudeCodeTelemetry';
import {
  SECURITY_DATASET_ID,
  SECURITY_DATASET_META,
  SECURITY_FEEDS,
  buildIncidentData,
} from '../domain/samples/security';
import { LAKE_DIRECT_ACCESS_ID, LAKE_INGEST_TOKEN_KV_KEY } from './criblApi';

/** Internal datagen sample id that marks the AI/OTel replay path. */
const OTEL_SAMPLE = 'claude_code_otel';

/**
 * AI-telemetry builds its OWN Cribl Search (Lakehouse) dataset — a
 * `cribl_search`/`provider: lakehouse` dataset linked to an EXISTING engine
 * (quick_search by default, chosen via the engine selector); we never create a
 * new engine. The plumbing mirrors what the Search UI creates for "Search engine"
 * datasets, keyed off a shared id so the engine routes by matching id:
 *  - a Lakehouse dataset `demo_<token>` linked to the selected engine,
 *  - a Local Search ingest Source listening on our own port, and
 *  - a `cribl_search_engine` destination `demo_<token>` targeting that port.
 * The destination id === dataset id, which is how the engine maps ingested
 * events to the dataset (matching the otel/sonicwall/cisco_asa pattern).
 */
const AI_INGEST_PORT = 20010;

/** Use case that runs the historical-backfill (AI Investigator) path. */
const AI_SECURITY_USE_CASE = 'uc-ai-security-investigation';
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
    engineId: partial?.engineId ?? DEFAULT_SEARCH_ENGINE_ID,
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
 * Build the OTel AI-enrichment pipeline. Runs on every feed for the AI-telemetry
 * use case (there is no SIEM split). It (1) parses the replayed Claude Code OTel
 * JSON out of `_raw` into top-level fields, (2) derives `total_tokens` on
 * api_request events, (3) classifies the prompt `subject` on user_prompt events
 * from the bundled keyword map, and (4) stamps demo/source metadata. The result
 * is structured JSON in Cribl Lake that the Search dashboards query by field.
 */
function buildOtelEnrichPipelineConf(streamtags: string[]): Record<string, unknown> {
  // Nested ternary: /pattern/i.test(prompt) ? 'Subject' : … : 'General'.
  const subjectExpr =
    subjectKeywords
      .map((k) => `/${k.pattern}/i.test(prompt||'') ? '${k.subject.replace(/'/g, "\\'")}' : `)
      .join('') + "'General'";

  const functions: Array<Record<string, unknown>> = [
    // 1. Parse the OTel JSON event from _raw into top-level fields.
    {
      id: 'serde',
      filter: 'true',
      conf: { mode: 'extract', type: 'json', srcField: '_raw', cleanFields: false },
    },
    // 2. Token total on api_request events.
    {
      id: 'eval',
      filter: "event_name=='claude_code.api_request'",
      conf: {
        add: [
          {
            name: 'total_tokens',
            value:
              '(input_tokens||0)+(output_tokens||0)+(cache_read_tokens||0)+(cache_creation_tokens||0)',
          },
        ],
      },
    },
    // 3. Subject classification on user_prompt events.
    {
      id: 'eval',
      filter: "event_name=='claude_code.user_prompt'",
      conf: { add: [{ name: 'subject', value: subjectExpr }] },
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
    description: 'OTel AI enrichment (parse, token totals, subject) — SE Demo Launcher',
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
 * The Lake dataset is plain v1 (no datatype binding — that runtime-errors), so
 * events land with the raw line in `_raw`. Rather than bind a datatype, we parse
 * at query time with KQL that we've verified runs in Cribl Search:
 *   - PAN traffic → `split(_raw, ',')` positional extraction (tested)
 *   - Linux/Windows → `extract()` regex, which returns null on no-match and so
 *     never fails execution
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

/**
 * Build the three AI-telemetry dashboards (Overview, Users & Teams, Subjects)
 * modeled on the llm_monitor reference app, querying the enriched OTel fields the
 * pipeline lands in the Lake dataset. Every query starts with `dataset="…"` so
 * the executor's dataset-id remap still applies. Uses only verified Cribl Search
 * KQL (summarize/bin/sum/count/dcount/case/sort/limit).
 */
function buildAiDashboards(
  token: string,
  title: string,
  datasetId: string,
): CriblObjectSpec[] {
  const api = `dataset="${datasetId}"\n| where event_name == "claude_code.api_request"`;
  const prompts = `dataset="${datasetId}"\n| where event_name == "claude_code.user_prompt"`;
  const all = `dataset="${datasetId}"`;

  const el = (
    id: string,
    type: string,
    dashTitle: string,
    query: string,
    layout: { x: number; y: number; w: number; h: number },
  ): DashboardElement => ({
    id,
    type,
    title: dashTitle,
    layout,
    search: { type: 'inline', query, earliest: '-60m', latest: 'now' },
  });

  const overview: DashboardElement[] = [
    el('ai_kpis', 'list.table', 'Usage summary',
      `${api}\n| summarize total_tokens = sum(total_tokens), est_cost_usd = round(sum(cost_usd), 2), active_users = dcount(user_id), sessions = dcount(session_id)`,
      { x: 0, y: 0, w: 12, h: 3 }),
    el('ai_tokens_over_time', 'chart.line', 'Token usage over time',
      `${api}\n| summarize tokens = sum(total_tokens) by bin(_time, 5m)\n| sort by _time asc`,
      { x: 0, y: 3, w: 8, h: 6 }),
    el('ai_cost_by_model', 'chart.pie', 'Cost by model',
      `${api}\n| summarize cost = round(sum(cost_usd), 2) by model\n| sort by cost desc`,
      { x: 8, y: 3, w: 4, h: 6 }),
    el('ai_spend_over_time', 'chart.area', 'Spend over time',
      `${api}\n| summarize cost = round(sum(cost_usd), 2) by bin(_time, 5m)\n| sort by _time asc`,
      { x: 0, y: 9, w: 8, h: 6 }),
    el('ai_tokens_by_model', 'chart.horizontalBar', 'Tokens by model',
      `${api}\n| summarize tokens = sum(total_tokens) by model\n| sort by tokens desc`,
      { x: 8, y: 9, w: 4, h: 6 }),
    el('ai_top_users_cost', 'list.table', 'Top users by cost',
      `${api}\n| summarize cost_usd = round(sum(cost_usd), 2), tokens = sum(total_tokens), requests = count() by user_email\n| sort by cost_usd desc\n| limit 10`,
      { x: 0, y: 15, w: 12, h: 7 }),
  ];

  const users: DashboardElement[] = [
    el('ai_tokens_by_user', 'chart.horizontalBar', 'Tokens by user',
      `${api}\n| summarize tokens = sum(total_tokens) by user_email\n| sort by tokens desc\n| limit 15`,
      { x: 0, y: 0, w: 6, h: 7 }),
    el('ai_cost_by_team', 'chart.column', 'Cost by team',
      `${api}\n| summarize cost = round(sum(cost_usd), 2) by team_id\n| sort by cost desc`,
      { x: 6, y: 0, w: 6, h: 7 }),
    el('ai_sessions_by_user', 'chart.horizontalBar', 'Sessions by user',
      `${all}\n| summarize sessions = dcount(session_id) by user_email\n| sort by sessions desc\n| limit 15`,
      { x: 0, y: 7, w: 6, h: 7 }),
    el('ai_tool_decisions', 'chart.pie', 'Tool decisions (accept vs reject)',
      `${all}\n| where event_name == "claude_code.tool_decision"\n| summarize count = count() by decision`,
      { x: 6, y: 7, w: 6, h: 7 }),
    el('ai_user_table', 'list.table', 'Usage by user',
      `${api}\n| summarize tokens = sum(total_tokens), cost_usd = round(sum(cost_usd), 2), requests = count(), sessions = dcount(session_id) by user_email, team_id\n| sort by cost_usd desc\n| limit 25`,
      { x: 0, y: 14, w: 12, h: 8 }),
  ];

  const subjects: DashboardElement[] = [
    el('ai_prompts_by_subject', 'chart.horizontalBar', 'What the org is building (by subject)',
      `${prompts}\n| summarize prompts = count() by subject\n| sort by prompts desc`,
      { x: 0, y: 0, w: 8, h: 7 }),
    el('ai_subject_share', 'chart.pie', 'Subject distribution',
      `${prompts}\n| summarize prompts = count() by subject\n| sort by prompts desc`,
      { x: 8, y: 0, w: 4, h: 7 }),
    el('ai_prompts_over_time', 'chart.line', 'Prompt volume over time',
      `${prompts}\n| summarize prompts = count() by bin(_time, 5m)\n| sort by _time asc`,
      { x: 0, y: 7, w: 12, h: 5 }),
    el('ai_subject_by_team', 'list.table', 'Subjects by team',
      `${prompts}\n| summarize prompts = count() by subject, team_id\n| sort by prompts desc\n| limit 25`,
      { x: 0, y: 12, w: 6, h: 7 }),
    el('ai_recent_prompts', 'list.events', 'Recent prompts',
      `${prompts}\n| project _time, user_email, subject, prompt\n| limit 100`,
      { x: 6, y: 12, w: 6, h: 7 }),
  ];

  const dash = (
    suffix: string,
    name: string,
    label: string,
    elements: DashboardElement[],
  ): CriblObjectSpec => ({
    kind: 'dashboard',
    id: `demo_dash_${token}_${suffix}`,
    role: 'dashboard',
    hidden: false,
    label,
    config: {
      name: sanitizeSearchName(name),
      description: `SE Demo Launcher AI-telemetry dashboard over ${datasetId}.`,
      elements,
    },
  });

  return [
    dash('overview', `${title} Overview`, `${title} — Overview`, overview),
    dash('users', `${title} Users and Teams`, `${title} — Users & Teams`, users),
    dash('subjects', `${title} Subjects`, `${title} — Subjects`, subjects),
  ];
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

  const savedSearchSpec: CriblObjectSpec = {
    kind: 'saved-search',
    id: `demo_saved_${token}`,
    role: 'saved-search',
    hidden: false,
    label: `${title} — recent events`,
    config: {
      name: sanitizeSearchName(`${title} recent events`),
      description: `SE Demo Launcher saved search over the Cribl Lake dataset ${datasetId}.`,
      query: eventsQuery,
      earliest: '-60m',
      latest: 'now',
    },
  };

  // AI/OTel gets three purpose-built dashboards (Overview, Users, Subjects);
  // every other source gets one source-aware dashboard.
  const dashboardSpecs: CriblObjectSpec[] =
    datagenSample === OTEL_SAMPLE
      ? buildAiDashboards(token, title, datasetId)
      : [
          {
            kind: 'dashboard',
            id: `demo_dash_${token}`,
            role: 'dashboard',
            hidden: false,
            label: `${title} — SE Demo dashboard`,
            config: {
              name: sanitizeSearchName(`${title} SE Demo`),
              description: `SE Demo Launcher dashboard over ${datasetId}.`,
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
  const source = sourceProfileById.get(selection.sourceProfileId);
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

  const listener = presentation.listenerType;
  const endpoint = `0.0.0.0:${source.defaultPort} (${source.loopListenerKind.toUpperCase()})`;
  const route = buildRoute(source.displayName, destinations);

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

  // AI-telemetry path: the enrichment pipeline runs on EVERY feed (no SIEM
  // split), and the feed lands in a per-demo Lakehouse (search-engine) dataset
  // linked to the selected engine (see AI_INGEST_PORT above).
  const enrichAllFeeds = processing.pipelineTemplate === 'otel-enrich';
  const engineId = selection.engineId ?? DEFAULT_SEARCH_ENGINE_ID;

  // Dataset backing the saved search + dashboards, dedicated to this demo. Both
  // paths create a per-demo dataset so the demo owns its data (rather than
  // sharing `default_logs`); the AI path makes it a Lakehouse dataset tied to a
  // Search engine, every other scenario makes it a federated Cribl Lake dataset.
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
  const datasetObject: CriblObjectSpec = enrichAllFeeds
    ? {
        // Lakehouse (search-engine) dataset linked to the existing engine.
        kind: 'lake-dataset',
        id: datasetId,
        role: 'search-dataset',
        hidden: false,
        label: `Cribl Search engine dataset (${datasetId})`,
        config: {
          description: `SE Demo Launcher dataset for ${useCase.title}`,
          engine: engineId,
          searchVersion: 'v1',
          retentionPeriod: 30,
        },
      }
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

  // Search tier: a saved search + dashboards over the dedicated dataset, plus a
  // passthrough Lake feed used only when no Lake destination is selected.
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
  const pack =
    processing.kind === 'custom-pipeline'
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

  const pipelineObject: CriblObjectSpec | undefined = pack
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
  if (enrichAllFeeds) {
    // AI path: enrich every event, then send to OUR OWN cribl_search_engine
    // destination targeting the Lakehouse ingest on our port. The destination id
    // equals the dataset id (demoDatasetId) so the engine routes ingested events
    // to our dataset (the otel/sonicwall/cisco_asa id-match pattern). The ingest
    // host is resolved at execution; only the port is fixed here.
    destObjects.push({
      kind: 'output',
      id: datasetId,
      role: 'destination',
      hidden: false,
      label: `Cribl Search engine (${datasetId})`,
      config: {
        type: 'cribl_search_engine',
        streamtags,
        description: `SE Demo Launcher AI telemetry → ${engineId} (${datasetId})`,
        // Executor fills `url` as http://<resolved-host>:<port> before create.
        __searchPort: AI_INGEST_PORT,
        excludeFields: ['__kube_*', '__metadata', '__winEvent'],
        compression: 'gzip',
      },
    });
    connections.push({ output: datasetId, pipeline: pipeId });
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
  // Lake dataset the feed writes into).
  const criblObjects: CriblObjectSpec[] = [
    ...(datasetObject ? [datasetObject] : []),
    ...(packObject ? [packObject] : []),
    ...destObjects,
    ...(pipelineObject ? [pipelineObject] : []),
    ...(injectObject ? [injectObject] : []),
    loopObject,
    sourceObject,
    datagenObject,
    savedSearchSpec,
    ...dashboardSpecs,
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
        if (enrichAllFeeds) {
          // Lakehouse (search-engine) dataset linked to the existing engine.
          op = {
            type: 'create-lakehouse-dataset',
            objectId: obj.id,
            engineId,
            config: obj.config,
          };
          kind = 'create-search-dataset';
          label = `Create Search engine dataset — ${obj.id}`;
          detail = `Lakehouse dataset ${obj.id} linked to the ${engineId} Search engine.`;
        } else {
          op = {
            type: 'create-lake-dataset',
            lakeId: LAKE_ID,
            objectId: obj.id,
            config: obj.config,
          };
          kind = 'create-search-dataset';
          label = `Create Cribl Search dataset — ${obj.id}`;
          detail = `Cribl Lake dataset ${obj.id} in the ${LAKE_ID} Lake, searchable in Cribl Search.`;
        }
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
        detail = 'Cribl Search dashboard in default_search over the federated dataset.';
        break;
      case 'output':
        if (obj.config.type === 'cribl_search_engine') {
          // Search-engine destination: the executor resolves the ingest host and
          // fills the url from `__searchPort` before creating the output.
          op = {
            type: 'create-search-output',
            objectId: obj.id,
            port: Number(obj.config.__searchPort ?? AI_INGEST_PORT),
            config: obj.config,
          };
        } else {
          op = { type: 'create-output', objectId: obj.id, config: obj.config };
        }
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

  // AI path: open a Local Search ingest listener on our port so the engine
  // receives what the cribl_search_engine destination sends. The source id is
  // the dataset id (not a `_ingest` suffix) so ingested events carry
  // `__inputId == 'cribl_http:<datasetId>'`, which the routing rule below matches.
  if (enrichAllFeeds) {
    actions.push({
      id: nextId('act'),
      kind: 'enable-route',
      label: `Open Search ingest on port ${AI_INGEST_PORT}`,
      detail: `Local Search ingest source ${datasetId} on the ${engineId} engine (cribl_http, 0.0.0.0:${AI_INGEST_PORT}).`,
      implementation: 'live',
      op: {
        type: 'create-search-source',
        objectId: datasetId,
        port: AI_INGEST_PORT,
        config: {
          type: 'cribl_http',
          host: '0.0.0.0',
          port: AI_INGEST_PORT,
          tls: { disabled: true },
        },
      },
    });

    // Route the engine's ingested events into our dataset. The engine drops
    // events that don't match a dataset rule, so this rule — matching our
    // ingest source id — is what actually lands data in the demo dataset.
    actions.push({
      id: nextId('act'),
      kind: 'enable-route',
      label: `Route ingest → ${datasetId}`,
      detail: `Add dataset rule __inputId == 'cribl_http:${datasetId}' → ${datasetId} on the ${engineId} engine.`,
      implementation: 'live',
      op: {
        type: 'route-dataset',
        engineId,
        datasetId,
        sourceId: datasetId,
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
        pipelineSummary: `${processing.displayName}: ${effectivePipelineSteps.join(' → ')}`,
      },
    },
    route,
    actions,
    estimatedActionCount: actions.length,
  };
}
