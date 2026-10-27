/**
 * Core domain model for the SE Demo Launcher.
 *
 * The model intentionally separates six independent building blocks
 * (use cases, source profiles, presentation modes, destinations, processing,
 * visual outcomes) so new Public Sector — or, later, other vertical — scenarios
 * can be assembled from reusable pieces rather than hardcoded flows.
 *
 * Demo-realism note: the visible "source" the SE selects is always a realistic
 * protocol/collector path (syslog, TCP, Windows event). Any underlying sample
 * data mechanism is an implementation detail captured in `SampleFeed` and is
 * never surfaced in user-facing copy.
 */

export type Id = string;

/** High-level Public Sector buying motions a use case can map to. */
export type PublicSectorMotion =
  | 'siem-cost-containment'
  | 'data-sovereignty'
  | 'shared-telemetry'
  | 'pii-handling';

/** Visible, protocol-realistic source families the SE can present. */
export type SourceFamily =
  | 'syslog'
  | 'tcp'
  | 'windows-event'
  | 'linux-infra'
  | 'ai-telemetry'
  | 'security-lake';

/**
 * Under-the-hood engine used to produce repeatable sample events. Cribl's
 * built-in datagen is the preferred mechanism; we deliberately avoid building an
 * external fake-data service. This term lives ONLY in code and plan objects and
 * must never appear in user-facing copy.
 */
export type GenerationMethod = 'cribl-datagen';

/**
 * The actual Cribl Stream input kind used to *present* the data as a realistic
 * source path. This is what the audience effectively sees; the generated sample
 * events are looped through an input of this kind.
 */
export type StreamInputKind = 'syslog' | 'tcp' | 'wef' | 'file' | 'otel';

/**
 * Run modes tune how much the wizard asks of the SE, matching how demos are run
 * live. Lightning = fewest decisions; POV = most explicit config + handoff.
 */
export type RunModeId = 'lightning' | 'standard' | 'pov';

export interface RunMode {
  id: RunModeId;
  displayName: string;
  summary: string;
  /** Best-fit context, e.g. "Live call". */
  bestFor: string;
  /** Wizard steps exposed for this mode (others accept template defaults). */
  exposedSteps: WizardStepKey[];
  /** Whether to surface detailed preflight + handoff panels. */
  showPreflightDetail: boolean;
  showHandoffDetail: boolean;
}

/** Wizard step identifiers, shared between the wizard and run-mode config. */
export type WizardStepKey =
  | 'source'
  | 'presentation'
  | 'destination'
  | 'processing'
  | 'overlays'
  | 'visual';

/**
 * Cross-cutting policy overlays. These are NOT standalone demos — they layer
 * onto a core template to add sovereignty, PII, or compliance behavior.
 */
export type OverlayId =
  | 'overlay-sovereignty'
  | 'overlay-pii'
  | 'overlay-compliance-archive';

export interface PolicyOverlay {
  id: OverlayId;
  displayName: string;
  summary: string;
  themes: ValueTheme[];
  /** Extra pipeline steps this overlay injects into processing. */
  pipelineAdditions: string[];
  /** Extra route behavior described for the review screen. */
  routeAdditions: string[];
  /** Destination role this overlay tends to add (e.g. compliance archive). */
  addsDestinationRole?: DestinationRole;
  /** Extra proof points the overlay contributes. */
  visualAdditions: string[];
}

/** How ingest is presented to the audience. Never "datagen". */
export type PresentationModeId =
  | 'syslog-listener'
  | 'tcp-listener'
  | 'windows-event-collector'
  | 'file-monitor'
  | 'otel-listener'
  | 'lake-backfill';

export type DestinationRole =
  | 'siem-analytics'
  | 'low-cost-store'
  | 'compliance-archive'
  | 'operations';

export type ProcessingKind = 'pack-backed' | 'custom-pipeline';

export type VisualOutcomeKind =
  | 'dashboard'
  | 'saved-search'
  | 'routing-summary'
  | 'data-quality-summary';

/** Value story a use case reinforces; drives copy and visual emphasis. */
export type ValueTheme =
  | 'cost-control'
  | 'telemetry-tiering'
  | 'dual-use-visibility'
  | 'pii-aware-handling'
  | 'operational-resilience'
  | 'controlled-routing'
  | 'migration-evaluation';

/**
 * Under-the-hood description of how realistic sample events are produced and
 * looped through Cribl. Deliberately internal — this is the ONLY place the
 * generation mechanism is named, and it must never be rendered to the user.
 */
export interface SampleFeed {
  /** Engine that produces the sample events. Preferred: Cribl built-in datagen. */
  method: GenerationMethod;
  /** Internal reference to the prebuilt sample set / datagen template. */
  internalTemplateRef: string;
  /** Approximate events-per-second the demo will appear to receive. */
  approxEventsPerSecond: number;
  /** Human note for maintainers only — never shown in the UI. */
  maintainerNote?: string;
}

/**
 * A visible source profile. Describes what the audience sees and how events
 * are shaped, independent of how sample data is produced.
 */
export interface SourceProfile {
  id: Id;
  family: SourceFamily;
  /** Field-ready name, e.g. "Palo Alto Firewall (syslog)". */
  displayName: string;
  /** One-line description for tiles and review screens. */
  summary: string;
  /** Realistic protocol / listener the demo presents. */
  protocol: string;
  /** Cribl Stream input kind that presents the looped sample events. */
  streamInputKind: StreamInputKind;
  /**
   * The actual listener type Cribl creates for the visible source. Datagen is
   * looped into a real listener of this kind so the source appears genuine.
   * (Windows presents as WEF but is fed via a `tcp` listener for feedability.)
   */
  loopListenerKind: 'syslog' | 'tcp';
  /**
   * Cribl built-in datagen sample file used under the hood. Internal only —
   * never rendered. Confirmed samples: 'palo_alto_traffic', 'sentinel_windowsevents'.
   */
  datagenSample: string;
  defaultPort: number;
  /** Representative fields the events carry, for schema-aware storytelling. */
  sampleSchema: SchemaField[];
  /** Destination roles this source pairs well with. */
  compatibleDestinations: DestinationRole[];
  /** Parsing assumptions surfaced on the review screen. */
  parsingAssumptions: string[];
  /** Internal-only feed definition. */
  sampleFeed: SampleFeed;
  /**
   * Optional app-shipped events replayed into the platform (internal only). When
   * set, the planner ignores `datagenSample` as the data source and instead uses
   * a built-in datagen as a clock, injecting these events via a replay pipeline.
   * Used where the data must exactly match a pack (e.g. Windows XML events).
   */
  replaySample?: ReplaySample;
}

/**
 * A bundled, app-shipped sample set that is replayed into the platform instead
 * of relying on a Cribl built-in datagen template. Custom datagen *files* cannot
 * be created via the REST API, so for sources whose data must exactly match a
 * pack (e.g. Windows XML events), we ship the raw events here. The planner uses
 * a built-in datagen purely as a clock and injects one of these events as `_raw`
 * on each tick via a replay pipeline.
 */
export interface ReplaySample {
  /** Raw event strings injected into `_raw`, one per generated tick (random). */
  events: string[];
  /** Splunk-style sourcetype set on each event (drives the pack's route match). */
  sourcetype: string;
  /** Splunk-style source set on each event. */
  source: string;
  /** Optional index label set on each event. */
  index?: string;
}

export interface SchemaField {
  name: string;
  type: 'string' | 'number' | 'ip' | 'timestamp' | 'boolean';
  /** Whether the field may carry PII/sensitive content. */
  sensitive?: boolean;
  example?: string;
}

/** How the source is presented at ingest time. */
export interface PresentationMode {
  id: PresentationModeId;
  displayName: string;
  summary: string;
  /** Source families this presentation is valid for. */
  appliesTo: SourceFamily[];
  /** Listener/collector type shown on the deploy summary. */
  listenerType: string;
}

export interface DestinationProfile {
  id: Id;
  role: DestinationRole;
  displayName: string;
  summary: string;
  /** e.g. "Splunk", "Amazon S3", "Local filesystem (sovereign)". */
  technology: string;
  /** Relative cost signal used in cost-control storytelling. */
  costTier: 'high' | 'medium' | 'low';
  /**
   * Template for the Cribl output this destination creates. `type` is the Cribl
   * output kind; `config` holds minimal fields so the destination saves cleanly
   * (it does not need to be live). The planner clones this and assigns an id.
   */
  criblOutput: {
    type: string;
    config: Record<string, unknown>;
  };
}

export interface ProcessingProfile {
  id: Id;
  kind: ProcessingKind;
  displayName: string;
  summary: string;
  /** Pack id when pack-backed; undefined for custom pipelines. */
  packRef?: string;
  /**
   * A real Cribl Pack to install and route the SIEM feed through. When set, the
   * planner installs the pack from `source` (Dispensary/URL/git) into the worker
   * group and points the SIEM QuickConnect connection at `pack:<id>`. When
   * absent, the planner builds a self-contained demo pipeline instead.
   */
  pack?: {
    /** Installed pack id, e.g. 'cribl-palo-alto-networks'. */
    id: string;
    /** Install source: a Dispensary/GitHub `.crbl` URL or `git+<repo>`. */
    source: string;
  };
  /** Ordered, human-readable description of what the processing does. */
  steps: string[];
  /** Value themes this processing reinforces. */
  themes: ValueTheme[];
  /**
   * Named built-in pipeline the planner should build instead of the generic
   * demo pipeline. 'otel-enrich' parses the OTel JSON, derives token totals, and
   * classifies the prompt subject. When set, the pipeline is applied to EVERY
   * feed (there is no SIEM split in the AI-telemetry path).
   */
  pipelineTemplate?: 'otel-enrich';
}

export interface VisualOutcomeProfile {
  id: Id;
  kind: VisualOutcomeKind;
  displayName: string;
  summary: string;
  /** Themes the visualization reinforces. */
  themes: ValueTheme[];
  /** Named assets the SE can show immediately after deploy. */
  assets: string[];
}

/**
 * A curated demo scenario. Rather than fixing every option, a use case template
 * declares its recommended defaults and the compatible choices the wizard
 * should offer, keeping the flow opinionated but flexible.
 */
export interface UseCaseTemplate {
  id: Id;
  title: string;
  /** Short value statement for the landing tile. */
  valueStatement: string;
  motion: PublicSectorMotion;
  themes: ValueTheme[];
  /** Primary visible source types the story leans on. */
  primarySourceProfileIds: Id[];
  /** Destination pattern description for the tile. */
  destinationPattern: string;
  /** One-line expected demo outcome for the tile. */
  expectedOutcome: string;

  /** Wizard option sets, expressed as ids into the registries. */
  compatibleSourceProfileIds: Id[];
  compatiblePresentationModeIds: PresentationModeId[];
  compatibleDestinationIds: Id[];
  compatibleProcessingIds: Id[];
  compatibleVisualOutcomeIds: Id[];

  /** Opinionated defaults so an SE can accept-and-go. */
  defaults: {
    sourceProfileId: Id;
    presentationModeId: PresentationModeId;
    destinationIds: Id[];
    processingId: Id;
    visualOutcomeIds: Id[];
  };

  /** Overlays this template supports layering on. */
  compatibleOverlayIds: OverlayId[];

  /** "What to say" panel: field-ready story beats for the SE. */
  talkTrack: TalkTrack;

  /** Optional copyable guidance shown after a successful deploy. */
  postDeploy?: PostDeployGuide;
}

/** Structured "what to say" content shown to the SE before/after deploy. */
export interface TalkTrack {
  customerProblem: string;
  criblAction: string;
  proofPoint: string;
  /** Optional extra one-liners the SE can drop in. */
  bullets?: string[];
}

/** A copyable, monospaced block shown in the post-deploy guide. */
export interface PostDeployBlock {
  label: string;
  /** Verbatim text the SE copies (e.g. an alert JSON or an investigator prompt). */
  text: string;
  /** Hint for styling only. */
  language?: 'text' | 'json' | 'kql';
}

/**
 * Optional, use-case-specific guidance rendered AFTER a successful deploy — e.g.
 * the seed alert + investigator prompt for the AI Investigator security demo.
 */
export interface PostDeployGuide {
  title: string;
  /** Short paragraph(s) of scenario/context shown above the copyable blocks. */
  intro?: string[];
  blocks: PostDeployBlock[];
  /** Closing one-liners (e.g. the expected verdict). */
  footnotes?: string[];
}

/** Routing mechanism used to wire source → destination. v1 is QuickConnect. */
export type RoutingMechanism = 'quickconnect';

/** Worker group the demo deploys into (Stream config group). */
export interface WorkerGroupRef {
  id: string;
  name: string;
  description?: string;
}

/** The concrete selection an SE makes in the wizard. */
export interface ScenarioSelection {
  useCaseId: Id;
  runMode: RunModeId;
  /** Target Stream worker group id (e.g. 'default'). */
  groupId: string;
  sourceProfileId: Id;
  presentationModeId: PresentationModeId;
  destinationIds: Id[];
  processingId: Id;
  overlayIds: OverlayId[];
  visualOutcomeIds: Id[];
  /**
   * Cribl Search engine to accelerate the demo's Lake dataset with (Lakehouse).
   * Only used by the AI-telemetry use case; defaults to `quick_search`.
   */
  engineId?: Id;
}

/** A selectable Cribl Search engine the demo dataset can be accelerated onto. */
export interface SearchEngine {
  id: Id;
  displayName: string;
  summary: string;
}

/**
 * A portable scenario definition an SE can save and hand to another SE/CSE/PS
 * resource. Versioned so future changes can be migrated.
 */
export interface SavedScenario {
  schemaVersion: 1;
  savedAt: string;
  name: string;
  notes?: string;
  selection: ScenarioSelection;
}

/* ------------------------------ Preflight --------------------------------- */

export type PreflightStatus = 'ok' | 'warn' | 'missing';

export interface PreflightCheck {
  id: Id;
  label: string;
  status: PreflightStatus;
  detail: string;
  /** True when this gap forces the demo into fallback mode. */
  forcesFallback?: boolean;
}

export type RunReadiness = 'full' | 'fallback';

/**
 * Result of pre-deploy environment probing. When a preferred destination or
 * product is unavailable, `readiness` drops to 'fallback' and the planner
 * preserves the routing story using Cribl-native Search/Lake paths.
 */
export interface PreflightResult {
  checkedAt: string;
  readiness: RunReadiness;
  canDeploy: boolean;
  checks: PreflightCheck[];
  /** Human explanation of any fallback substitution. */
  fallbackNote?: string;
}

/** Mocked view of what the target environment supports. */
export interface EnvironmentCapabilities {
  /** Products available, e.g. 'stream', 'search', 'lake'. */
  products: string[];
  /** Destination technologies present in the environment. */
  destinationTech: string[];
}

/* ----------------------------- Deployment plan ---------------------------- */

/** Concrete Cribl Stream input (listener/source) that presents the data. */
export interface StreamSourceConfig {
  /** Stream input kind, e.g. 'syslog'. */
  inputKind: StreamInputKind;
  /** Visible source name shown to the audience. */
  displayName: string;
  protocol: string;
  host: string;
  port: number;
}

/**
 * Explicit separation of the demo data path, per the product rule that
 * internal generation and visible presentation must be distinct concerns.
 * This object is the code-level source of truth for "datagen internally,
 * realistic source externally". Only `visibleSource` / `streamListener` are
 * ever safe to render; `internalGeneration` is for maintainers and the executor.
 */
export interface DemoDataPath {
  /** Under-the-hood generation. NEVER render this layer to users. */
  internalGeneration: {
    method: GenerationMethod;
    templateRef: string;
    approxEventsPerSecond: number;
  };
  /** What the audience believes the source is. */
  visibleSource: {
    displayName: string;
    protocol: string;
  };
  /** The Stream input that carries the looped events. */
  streamListener: StreamSourceConfig;
  /** Behavior applied once data is ingested. */
  postIngest: {
    routeSummary: string;
    pipelineSummary: string;
  };
}

export type DeploymentActionKind =
  | 'create-source'
  | 'enable-route'
  | 'apply-pack'
  | 'apply-pipeline'
  | 'connect-destination'
  | 'enable-visual-asset'
  | 'create-search-dataset'
  | 'accelerate-dataset'
  | 'create-saved-search'
  | 'create-dashboard'
  | 'seed-sample-feed'
  | 'backfill-data';

/**
 * Concrete operation the executor performs for an action. This is what makes
 * deployment real: create-input / create-output write config to Cribl via the
 * REST API; commit-deploy pushes the group config to workers.
 */
export type DeploymentOp =
  | { type: 'create-input'; objectId: string; config: Record<string, unknown> }
  | { type: 'create-output'; objectId: string; config: Record<string, unknown> }
  | { type: 'create-pipeline'; objectId: string; conf: Record<string, unknown> }
  | { type: 'install-pack'; objectId: string; source: string }
  | { type: 'create-lake-dataset'; lakeId: string; objectId: string; config: Record<string, unknown> }
  | { type: 'accelerate-dataset'; lakeId: string; objectId: string; engineId: string; config: Record<string, unknown> }
  | { type: 'create-lakehouse-dataset'; objectId: string; engineId: string; config: Record<string, unknown> }
  | { type: 'create-search-source'; objectId: string; port: number; config: Record<string, unknown> }
  | { type: 'create-search-output'; objectId: string; port: number; config: Record<string, unknown> }
  | { type: 'route-dataset'; engineId: string; datasetId: string; sourceId: string }
  | { type: 'create-saved-search'; objectId: string; config: Record<string, unknown> }
  | { type: 'create-dashboard'; objectId: string; config: Record<string, unknown> }
  // ---- Historical-backfill (AI Investigator security demo) ----
  // Store the Direct Access ingest token in this app's KV store so proxies.yml
  // can inject it as the Authorization header (browser-set auth is stripped).
  | { type: 'put-ingest-token'; key: string; token: string }
  // Ensure the Lake Direct Access HTTP Source exists (with our token).
  | { type: 'ensure-direct-access'; lakeId: string; sourceId: string; token: string }
  // Generate backdated NDJSON for one feed and POST it to the dataset's ingest URL.
  | {
      type: 'backfill-dataset';
      lakeId: string;
      sourceId: string;
      objectId: string;
      feed: string;
      seed: number;
      windowHours: number;
      anchorSec: number;
    }
  // Best-effort: attach description + tags to a dataset's federated Search entry.
  | { type: 'tag-federated-dataset'; objectId: string; description?: string; tags?: string[] }
  | { type: 'commit-deploy' };

export interface DeploymentAction {
  id: Id;
  kind: DeploymentActionKind;
  /** Field-ready label shown on the deploy summary. */
  label: string;
  /** Longer human description of what will happen. */
  detail: string;
  /**
   * 'live' actions call the Cribl REST API via `op`; 'stub' actions resolve
   * without side effects (used when no concrete op applies).
   */
  implementation: 'stub' | 'live';
  /** The concrete API operation, when this action is live. */
  op?: DeploymentOp;
}

/**
 * A concrete Cribl object the plan will create. Encodes the internal-vs-visible
 * separation: datagen/loop objects are `hidden`; the listener source and the
 * destination are what the SE presents.
 */
export interface CriblObjectSpec {
  kind:
    | 'input'
    | 'output'
    | 'pipeline'
    | 'pack'
    | 'lake-dataset'
    | 'saved-search'
    | 'dashboard';
  id: string;
  /** datagen + loop are hidden plumbing; the rest are presented to the audience. */
  role:
    | 'datagen'
    | 'loop'
    | 'source'
    | 'destination'
    | 'pipeline'
    | 'pack'
    | 'search-dataset'
    | 'saved-search'
    | 'dashboard';
  hidden: boolean;
  /**
   * Config body POSTed to Cribl. For inputs/outputs this is the flat object
   * config; for a pipeline this is the pipeline `conf` (functions, etc.).
   */
  config: Record<string, unknown>;
  /** Short human label for the review screen. */
  label: string;
}

export interface RouteStep {
  from: string;
  to: string;
  /** Condition/label, e.g. "priority=high", "compliance class C2". */
  condition?: string;
}

/**
 * The full, concrete plan produced by the deployment planner from a selection.
 * This is the artifact the review screen renders and the executor consumes.
 */
export interface DeploymentPlan {
  id: Id;
  createdAt: string;
  selection: ScenarioSelection;

  /** Resolved objects, denormalized for easy rendering. */
  useCase: UseCaseTemplate;
  runMode: RunMode;
  source: SourceProfile;
  presentation: PresentationMode;
  destinations: DestinationProfile[];
  processing: ProcessingProfile;
  overlays: PolicyOverlay[];
  visualOutcomes: VisualOutcomeProfile[];

  /** Target worker group and routing mechanism for this deployment. */
  groupId: string;
  routingMechanism: RoutingMechanism;
  /** Stream tags applied to every created object, for QuickConnect filtering. */
  streamtags: string[];
  /** The concrete Cribl objects this plan creates (datagen → loop → source → destinations). */
  criblObjects: CriblObjectSpec[];

  /** Effective readiness this plan was built for ('full' or 'fallback'). */
  readiness: RunReadiness;
  /** Set when a destination was substituted for a Cribl-native fallback. */
  fallbackNote?: string;

  /** How the simulated source will appear in the demo (audience-facing copy). */
  sourcePresentation: {
    displayName: string;
    listener: string;
    endpoint: string;
  };

  /**
   * Explicit four-layer data path. Encodes the internal-vs-visible separation
   * in code so the distinction is auditable and maintainable.
   */
  dataPath: DemoDataPath;

  route: RouteStep[];
  actions: DeploymentAction[];
  /** Count surfaced as "estimated deployment actions". */
  estimatedActionCount: number;
}

/* ------------------------------ Execution --------------------------------- */

export type DeploymentStatus = 'idle' | 'running' | 'succeeded' | 'failed';

export interface DeploymentResult {
  planId: Id;
  status: DeploymentStatus;
  startedAt: string;
  finishedAt?: string;
  /** Per-action outcome, keyed by action id. */
  actionResults: DeploymentActionResult[];
  message?: string;
}

export interface DeploymentActionResult {
  actionId: Id;
  label: string;
  status: DeploymentStatus;
  message?: string;
}

/* ------------------------------ Validation -------------------------------- */

export type CheckStatus = 'pass' | 'fail' | 'pending' | 'skipped';

export interface ValidationCheck {
  id: Id;
  label: string;
  status: CheckStatus;
  /** Operational-sounding detail, e.g. "1,204 events in last 60s". */
  detail?: string;
}

export interface ValidationResult {
  planId: Id;
  checkedAt: string;
  overall: CheckStatus;
  checks: ValidationCheck[];
}

/* -------------------------------- Reset ----------------------------------- */

export interface ResetResult {
  planId: Id;
  resetAt: string;
  status: DeploymentStatus;
  removedActionIds: Id[];
  message?: string;
}
