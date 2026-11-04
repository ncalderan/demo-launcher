import type { UseCaseTemplate } from '../types';
import externalApiAccessStep1 from '../../assets/screenshots/external-api-access-step1-settings-menu.png';
import externalApiAccessStep2 from '../../assets/screenshots/external-api-access-step2-id-field.png';

/**
 * Curated SE Demo Launcher scenarios. v1 leads with concrete operator
 * outcomes (migration, cost-controlled tiering, shared telemetry). Sovereignty,
 * PII, and compliance are applied as overlays rather than standalone demos.
 *
 * Each template declares opinionated defaults so an SE can accept-and-go, plus
 * the compatible option sets the wizard offers.
 */
export const useCaseTemplates: UseCaseTemplate[] = [
  {
    id: 'uc-dual-feed-siem-migration',
    tileIcon: { kind: 'product', product: 'stream' },
    title: 'Dual-Feed SIEM Migration / Evaluation',
    valueStatement:
      'Feed the same telemetry to your current and target SIEM at once — evaluate or migrate without interrupting data flow.',
    motion: 'siem-cost-containment',
    themes: ['migration-evaluation', 'operational-resilience'],
    primarySourceProfileIds: ['src-pan-firewall-syslog'],
    destinationPattern: 'Current SIEM + target SIEM (+ optional low-cost retention)',
    expectedOutcome: 'One source proven feeding two SIEMs with no interruption',

    compatibleSourceProfileIds: [
      'src-pan-firewall-syslog',
      'src-windows-security-events',
      'src-cisco-asa-firewall',
      'src-checkpoint-firewall',
      'src-crowdstrike-falcon',
      'src-f5-bigip',
      'src-zscaler-internet-access',
    ],
    compatiblePresentationModeIds: ['syslog-listener', 'windows-event-collector'],
    compatibleDestinationIds: [
      'dst-siem-current',
      'dst-siem-target',
      'dst-cribl-lake',
      'dst-lake-s3',
    ],
    compatibleProcessingIds: [
      'proc-pack-firewall-optimization',
      'proc-custom-policy-routing',
      'proc-pack-cisco-asa-cleanup',
      'proc-pack-checkpoint',
      'proc-pack-crowdstrike',
      'proc-pack-f5-bigip',
      'proc-pack-zscaler',
    ],
    compatibleVisualOutcomeIds: ['viz-dual-feed', 'viz-routing-split'],
    compatibleOverlayIds: ['overlay-pii', 'overlay-compliance-archive'],

    defaults: {
      sourceProfileId: 'src-pan-firewall-syslog',
      presentationModeId: 'syslog-listener',
      destinationIds: ['dst-siem-current', 'dst-siem-target'],
      processingId: 'proc-pack-firewall-optimization',
      visualOutcomeIds: ['viz-dual-feed'],
    },

    talkTrack: {
      customerProblem:
        'Migrating or evaluating a new SIEM is risky — teams fear gaps, re-onboarding, and double ingest cost.',
      criblAction:
        'Cribl fans one incoming telemetry stream to both the current and target SIEM in parallel, with normalization and routing tags applied in flight.',
      proofPoint:
        'Show the same events landing in both SIEMs simultaneously — a low-risk, no-interruption migration path.',
      bullets: [
        'No re-onboarding of sources per platform.',
        'Route only what each platform needs to control cost.',
        'Cut over when ready — Cribl is the control point.',
      ],
    },
  },
  {
    id: 'uc-cost-controlled-tiered-retention',
    tileIcon: { kind: 'product', product: 'lake' },
    title: 'Tiered Retention',
    valueStatement:
      'Send high-value events to the SIEM, keep a searchable operational subset, and tier the rest to low-cost retention.',
    motion: 'siem-cost-containment',
    themes: ['cost-control', 'telemetry-tiering'],
    primarySourceProfileIds: ['src-pan-firewall-syslog'],
    destinationPattern: 'SIEM + Federated Search + Lake retention',
    expectedOutcome: 'Measurable volume reduction with the right data in each tier',

    compatibleSourceProfileIds: [
      'src-pan-firewall-syslog',
      'src-linux-infra-syslog',
      'src-cisco-asa-firewall',
      'src-checkpoint-firewall',
      'src-crowdstrike-falcon',
      'src-f5-bigip',
      'src-zscaler-internet-access',
    ],
    compatiblePresentationModeIds: ['syslog-listener', 'file-monitor'],
    compatibleDestinationIds: [
      'dst-siem-current',
      'dst-cribl-search',
      'dst-cribl-lake',
      'dst-lake-s3',
      'dst-compliance-local',
    ],
    compatibleProcessingIds: [
      'proc-pack-firewall-optimization',
      'proc-custom-mask-reduce',
      'proc-pack-cisco-asa-cleanup',
      'proc-pack-checkpoint',
      'proc-pack-crowdstrike',
      'proc-pack-f5-bigip',
      'proc-pack-zscaler',
    ],
    compatibleVisualOutcomeIds: ['viz-volume-reduction', 'viz-routing-split'],
    compatibleOverlayIds: [
      'overlay-sovereignty',
      'overlay-pii',
      'overlay-compliance-archive',
    ],

    defaults: {
      sourceProfileId: 'src-pan-firewall-syslog',
      presentationModeId: 'syslog-listener',
      destinationIds: ['dst-siem-current', 'dst-cribl-search', 'dst-cribl-lake'],
      processingId: 'proc-pack-firewall-optimization',
      visualOutcomeIds: ['viz-volume-reduction', 'viz-routing-split'],
    },

    talkTrack: {
      customerProblem:
        'SIEM licensing scales with ingest, and Public Sector budgets are fixed — but nobody wants to lose data.',
      criblAction:
        'Cribl filters and samples noise, routes high-value events to the SIEM, keeps an operational subset searchable, and tiers the rest to low-cost retention.',
      proofPoint:
        'Show input volume vs. what reached the SIEM, and the tier split by destination — right data, right destination, right cost.',
      bullets: [
        'Drop keep-alives and low-value noise before licensing counts it.',
        'Everything stays replayable from low-cost retention.',
        'Budget goes to the data that earns its place in the SIEM.',
      ],
    },
  },
  {
    id: 'uc-windows-shared-visibility',
    tileIcon: { kind: 'product', product: 'stream' },
    title: 'Windows Shared Visibility for IT & Security',
    valueStatement:
      'One Windows event stream serves both the SOC and IT operations — no duplicate tooling, no double storage.',
    motion: 'shared-telemetry',
    themes: ['dual-use-visibility', 'telemetry-tiering'],
    primarySourceProfileIds: ['src-windows-security-events'],
    destinationPattern: 'Security path + operations/troubleshooting path',
    expectedOutcome: 'One source, two consumer outcomes, less duplication',

    compatibleSourceProfileIds: ['src-windows-security-events'],
    compatiblePresentationModeIds: ['windows-event-collector'],
    compatibleDestinationIds: [
      'dst-siem-current',
      'dst-ops-elastic',
      'dst-cribl-search',
      'dst-cribl-lake',
    ],
    compatibleProcessingIds: ['proc-pack-windows-normalization', 'proc-custom-policy-routing'],
    compatibleVisualOutcomeIds: ['viz-dual-use', 'viz-routing-split'],
    compatibleOverlayIds: ['overlay-pii', 'overlay-sovereignty', 'overlay-compliance-archive'],

    defaults: {
      sourceProfileId: 'src-windows-security-events',
      presentationModeId: 'windows-event-collector',
      destinationIds: ['dst-siem-current', 'dst-ops-elastic'],
      processingId: 'proc-pack-windows-normalization',
      visualOutcomeIds: ['viz-dual-use'],
    },

    talkTrack: {
      customerProblem:
        'Security and IT operations fight over the same Windows logs and often stand up separate, duplicative pipelines.',
      criblAction:
        'Cribl normalizes the stream once, then routes security-relevant events to the SOC and simplified operational events to IT.',
      proofPoint:
        'Show one incoming stream producing two team-specific outcomes — less onboarding, less duplicate storage.',
      bullets: [
        'Normalize once, serve many.',
        'SOC keeps security fidelity; IT gets clean troubleshooting events.',
        'Summarize repetitive patterns to cut operational noise.',
      ],
    },
  },
  {
    id: 'uc-ai-observability',
    tileIcon: { kind: 'primary-source' },
    title: 'AI Observability (official Cribl app)',
    valueStatement:
      'Send genuine Claude Code OpenTelemetry traffic straight to the official Cribl "AI Observability" app\'s own OTLP listener, and show its real Usage & Cost, Sessions & Traces, and Top Models dashboards — not a look-alike.',
    motion: 'shared-telemetry',
    themes: ['telemetry-tiering', 'operational-resilience', 'cost-control'],
    primarySourceProfileIds: ['src-ai-claude-otel'],
    destinationPattern: "Claude Code OTLP → the app's own OTLP listener",
    expectedOutcome: 'The real AI Observability app, populated with live agent telemetry',

    compatibleSourceProfileIds: ['src-ai-claude-otel'],
    compatiblePresentationModeIds: ['otel-listener'],
    // No destination tiles — this use case sends straight to an SE-provided
    // OTLP host:port (see `otelIngestHost` on ScenarioSelection), collected in
    // the wizard's "destination" step instead of a tile picker.
    compatibleDestinationIds: [],
    compatibleProcessingIds: ['proc-custom-otel-enrich'],
    compatibleVisualOutcomeIds: ['viz-ai-telemetry'],
    compatibleOverlayIds: [],

    defaults: {
      sourceProfileId: 'src-ai-claude-otel',
      presentationModeId: 'otel-listener',
      destinationIds: [],
      processingId: 'proc-custom-otel-enrich',
      visualOutcomeIds: ['viz-ai-telemetry'],
    },

    talkTrack: {
      customerProblem:
        'AI coding agents are rolling out fast, but leaders have no visibility into cost, adoption, or what teams are actually building with them — and a hand-built dashboard looks like a science project, not a product.',
      criblAction:
        'Cribl generates genuine Claude Code OTLP traffic and sends it straight to the official "AI Observability" app\'s own listener — its ingestion pack normalizes and lands the data automatically.',
      proofPoint:
        'Open the actual AI Observability app and show live Usage & Cost, Sessions & Traces, and Top Models — the real product, not a demo-only recreation.',
      bullets: [
        'PREFLIGHT (one-time, manual): install "AI Observability" from the Cribl marketplace catalog and run its Setup Wizard — do this from Cribl UI → Apps → catalog before running this use case.',
        "Copy the OTLP host:port the Setup Wizard assigns you into this use case's config step.",
        'One Claude Code OTel feed → the official app\'s own Usage & Cost, Sessions & Traces, and Top Models panels.',
        "Reset only tears down this run's pipeline and destinations — the app itself is never touched.",
      ],
    },

    postDeploy: {
      title: 'Open the AI Observability app',
      intro: [
        'Allow ~30-60s after deploy for the first events to land, then open the app from the Cribl UI (Apps → AI Observability) and check Usage & Cost / Sessions & Traces / Top Models.',
        "If nothing shows up, double-check the OTLP host:port you pasted and that the app's Setup Wizard has finished provisioning its listener.",
      ],
      blocks: [],
    },
  },
  {
    id: 'uc-ai-security-investigation',
    tileIcon: { kind: 'product', product: 'search' },
    title: 'AI Investigator: Supply-Chain Compromise (Cribl Lake)',
    valueStatement:
      'One click backfills a realistic, historically-timestamped supply-chain attack across five correlated Lake datasets — then the Cribl Search AI Investigator reconstructs the whole incident from federated search.',
    motion: 'shared-telemetry',
    themes: ['operational-resilience', 'dual-use-visibility'],
    primarySourceProfileIds: ['src-security-lake-backfill'],
    destinationPattern: 'App-authored events → Cribl Lake (Direct Access HTTP) → federated Cribl Search',
    expectedOutcome:
      'AI Investigator correlates install → credential theft → C2 egress → token misuse to a verdict',

    compatibleSourceProfileIds: ['src-security-lake-backfill'],
    compatiblePresentationModeIds: ['lake-backfill'],
    compatibleDestinationIds: ['dst-cribl-lake'],
    compatibleProcessingIds: ['proc-security-backfill'],
    compatibleVisualOutcomeIds: ['viz-ai-investigation'],
    compatibleOverlayIds: [],

    requirementNote:
      'Requires a one-time manual admin step (External API Access) — deploy once to get the exact host, then see the first PREFLIGHT bullet below. First deploy can take up to ~10 minutes to provision.',

    defaults: {
      sourceProfileId: 'src-security-lake-backfill',
      presentationModeId: 'lake-backfill',
      destinationIds: ['dst-cribl-lake'],
      processingId: 'proc-security-backfill',
      visualOutcomeIds: ['viz-ai-investigation'],
    },

    talkTrack: {
      customerProblem:
        'A developer installs a popular-looking MCP server from GitHub (~2,000 stars, "40% cost savings"). It is a trojan that steals credential files and exfiltrates them overseas. Analysts face five siloed log sources and no time to hand-pivot the whole chain.',
      criblAction:
        'Cribl Search Investigations (AI Investigator) runs federated search across the Cribl Lake datasets, extracts entities from a single EDR alert, and correlates endpoint → DNS → firewall → identity → source-control activity into one timeline — no data movement, no pre-built SIEM content.',
      proofPoint:
        'From one seed alert, the investigator reaches the verdict: ~11 users touched sensitive files, 4 machines are compromised, and M. Brown is worst affected — with the credential-theft → C2 egress → token-misuse chain laid out.',
      setupSteps: [
        {
          image: externalApiAccessStep1,
          alt: 'App header ⋯ menu open, showing Settings, Share, and Delete',
          caption:
            'In this app, click the ⋯ menu at the top right of the header and choose Settings.',
        },
        {
          image: externalApiAccessStep2,
          alt: 'External API Access tab showing the proxies.yml-style JSON entry with its id field',
          caption:
            'Open the External API Access tab. Edit (or add) the entry\'s id to the EXACT host:10080 from the failed-deploy error — not a wildcard. Keep the existing headers.inject.Authorization: kv.demoLakeIngestToken and allowlist: [content-type] as-is; only the id changes per org.',
          highlight: 'id: "direct-access-<your-host>.<org>.cribl.cloud:10080"',
        },
      ],
      bullets: [
        'PREFLIGHT: Cribl Search Investigations is a Preview feature — enable it under Global Settings → AI Settings on a paid Search tenant before demoing.',
        'PREFLIGHT, REQUIRED, MANUAL — Cribl can\'t grant this to itself: deploy once, let it fail with "Domain ... is not declared in proxies.yml", then follow the setup steps above. This is per-org and one-time, not something this app can do for you.',
        'PREFLIGHT: first deploy provisions a new Direct Access HTTP source from scratch — this can take up to ~10 minutes. The deploy screen will show "Enable Cribl Lake Direct Access (HTTP)" in progress; that\'s expected, not stuck.',
        'Datasets created: archive_edr, archive_dns, archive_firewall, archive_identity, archive_vcs (authentic names so the AI treats them as real telemetry).',
        'WHY IT LANDS: the incident is backdated ~45 days — beyond a typical 30-day SIEM retention window. The data only exists in the Lake archive, so federated Search over 90 days is the differentiator. If it were a few days old, the customer would just use their SIEM.',
        'After deploy, allow ~1 minute for the backfilled events to become searchable, then confirm with: dataset="archive_edr" earliest=-90d | head 20',
        'SCOPE THE INVESTIGATION: in Cribl Search → Investigations, select ONLY the five archive_* datasets and set the range to Last 90 days (-90d to now). The investigator defaults to 7 days and pre-existing tenant datasets (windows/default_logs), which miss the ~45-day-old incident.',
        'SEED ALERT (paste into the investigator): {"alert_name":"EDR: Sensitive credential files read by npm postinstall","severity":"high","host":"wks-brown-mbp","user":"m.brown","process_name":"node","parent_process":"postinstall.js","file_path":"~/.aws/credentials","package":"mcp-cost-optimizer","dataset":"archive_edr"}',
        'INVESTIGATOR PROMPT (paste right after the alert): "This alert came from our SIEM. Show me how it looks historically across our archived security data - how it started, what happened next, whether any data was exfiltrated, and how many users and machines are affected."',
        'Reset removes the archive_* datasets, the ingest token, and this app\'s Direct Access tokens.',
      ],
    },

    postDeploy: {
      title: 'Run the AI Investigator',
      intro: [
        'The story: your SIEM forwards a high-severity detection — on developer workstation wks-brown-mbp, a node process spawned by an npm postinstall.js hook read ~/.aws/credentials. Install hooks should never touch cloud credentials. The package is mcp-cost-optimizer, a popular-looking MCP server (~2,000 GitHub stars) a few devs installed for "40% cost savings."',
        'Why it needs the Lake: the incident is ~45 days old — past a typical 30-day SIEM retention window — so the underlying telemetry has already aged out of the SIEM. This is a retroactive hunt: you pivot into the 90-day Cribl Lake archive, where the evidence still lives, and let federated Search reconstruct it.',
        'IMPORTANT — the investigator defaults to a 7-day range and whatever datasets already exist in the tenant. You MUST re-scope it to the five archive_* datasets and a 90-day range (step 2 below) or it will return nothing. Allow ~1 minute after deploy for the backfilled events to become searchable, then open Cribl Search → Investigations and start a new investigation.',
      ],
      blocks: [
        {
          label: '1) Confirm the data is searchable (Cribl Search, 90-day lookback)',
          language: 'kql',
          text: 'dataset="archive_edr" earliest=-90d | head 20',
        },
        {
          label: '2) Scope the investigation — select ONLY these datasets + this range',
          language: 'text',
          text: `Datasets (deselect windows / default_logs / anything else):
archive_edr
archive_dns
archive_firewall
archive_identity
archive_vcs

Time range: Last 90 days  (custom: -90d to now)`,
        },
        {
          label: '3) Start the investigation — paste this (alert + question)',
          language: 'text',
          text: `This alert came from our SIEM:

{
  "alert_name": "EDR: Sensitive credential files read by npm postinstall",
  "severity": "high",
  "host": "wks-brown-mbp",
  "user": "m.brown",
  "process_name": "node",
  "parent_process": "postinstall.js",
  "file_path": "~/.aws/credentials",
  "package": "mcp-cost-optimizer",
  "dataset": "archive_edr"
}

Show me how it looks historically across our archived security data - how it started, what happened next, whether any data was exfiltrated, and how many users and machines are affected.`,
        },
      ],
      footnotes: [
        'Expected reconstruction: install (archive_vcs) → credential read by postinstall (archive_edr) → C2 DNS (archive_dns) → RO/MD egress byte-spike (archive_firewall) → Okta token misuse (archive_identity).',
        'Expected verdict: ~11 users touched sensitive files, 4 machines compromised, m.brown most affected.',
      ],
    },
  },
  {
    id: 'uc-lakehouse-engine',
    tileIcon: { kind: 'product', product: 'lakehouse' },
    title: 'Lakehouse Engine Routing',
    valueStatement:
      'Point any data source straight at an existing Cribl Search Lakehouse engine and land on a dashboard built for that source — one hub for whatever you route into it.',
    motion: 'shared-telemetry',
    themes: ['operational-resilience', 'telemetry-tiering'],
    primarySourceProfileIds: ['src-pan-firewall-syslog'],
    destinationPattern: 'Source → native Cribl Search Lakehouse engine ingest',
    expectedOutcome: 'A source-matched dashboard, live over data routed natively into the engine',

    compatibleSourceProfileIds: [
      'src-pan-firewall-syslog',
      'src-windows-security-events',
      'src-linux-infra-syslog',
      'src-cisco-asa-firewall',
      'src-checkpoint-firewall',
      'src-crowdstrike-falcon',
      'src-f5-bigip',
      'src-zscaler-internet-access',
    ],
    compatiblePresentationModeIds: ['syslog-listener', 'windows-event-collector', 'tcp-listener'],
    // No destination tiles — the "destination" IS the SE-picked Lakehouse
    // engine, collected via the wizard's destination-step engine picker (see
    // `requiresSearchEngine` below), not a tile list.
    compatibleDestinationIds: [],
    // No custom-pipeline alternatives to offer — every compatible source
    // already has a real Cribl Pack match, but packs apply to a SIEM
    // QuickConnect pipeline this use case doesn't create (events are parsed
    // search-side instead, same as the generic fallback dashboard today).
    compatibleProcessingIds: [],
    compatibleVisualOutcomeIds: ['viz-lakehouse-dashboard'],
    compatibleOverlayIds: [],

    requiresSearchEngine: true,
    requirementNote: 'Requires an existing Lakehouse engine',

    defaults: {
      sourceProfileId: 'src-pan-firewall-syslog',
      presentationModeId: 'syslog-listener',
      destinationIds: [],
      processingId: 'proc-pack-firewall-optimization',
      visualOutcomeIds: ['viz-lakehouse-dashboard'],
    },

    talkTrack: {
      customerProblem:
        'Teams stand up a new Lakehouse engine and then face the same question for every new source: how do we actually get THIS data into it, and will it look like anything useful once it lands?',
      criblAction:
        'Cribl discovers the Lakehouse engines already provisioned in the org, routes the chosen source straight into the one you pick with no intermediate federated Lake hop, and creates a real Search dashboard tailored to that source — networking panels for a firewall, event/code-monitoring panels for Windows, and so on.',
      proofPoint:
        'Pick any source, route it live into an existing engine, and open a populated, source-specific dashboard within a minute.',
      bullets: [
        'PREREQUISITE: this use case requires an existing Lakehouse engine in the org — it does not provision one. Create one first (Cribl Search → Engines) if none exists.',
        'No intermediate Cribl Lake dataset — the source routes natively to the engine via its own ingest listener and dataset-ruleset.',
        'Swap the source and the dashboard swaps with it — same engine, same flow, new story.',
        'Reset removes only this run\'s dataset, route, and ingest source — the engine itself is never touched.',
      ],
    },
  },
];

export const useCaseTemplateById = new Map(useCaseTemplates.map((u) => [u.id, u]));
