# SE Demo Launcher

A Cribl App for the Solutions Engineer organization. The first release is
optimized for **Public Sector** demos and POV acceleration.

It gives an SE a one-stop, guided workflow to stand up a realistic, repeatable
Cribl demo in minutes — a complete story from **source → route → destination →
visualization** — rather than a disconnected dashboard or a static config
generator.

## App purpose

Pick a scenario, present a realistic source, route the data through Cribl in a
believable way, and land on a proof point that reinforces the value story.
Everything is opinionated for speed, repeatability, and clean storytelling.

The v1 use cases lead with concrete operator outcomes and map to Public Sector
buying motions:

1. **Dual-Feed SIEM Migration / Evaluation** — one source feeding current and
   target SIEM simultaneously, no interruption.
2. **Cost-Controlled Tiered Retention** — high-value events to the SIEM, an
   operational subset searchable, the rest tiered to low-cost retention.
3. **Windows Shared Visibility for IT & Security** — one Windows stream serving
   both the SOC and IT operations.

Sovereignty/residency, PII, and compliance-archive stories are applied as
**policy overlays** on top of these templates, not as standalone demos.

## Guided flow

Landing → Wizard (source, ingestion mode, route/destination, processing,
overlays, visual outcome) → Review (preflight + deploy summary) → Deploy &
Validate → Reset.

Three **run modes** tune how much the wizard asks:

- **Lightning Demo** — fewest decisions, best for live calls (accepts template
  defaults).
- **Standard Demo** — balanced setup for a full technical demo.
- **POV Mode** — explicit configuration, validation, and handoff detail.

## Design assumptions

- The SE is technical but busy. Optimize for minimal clicks and confident
  storytelling over maximum configurability.
- Templates are **structured config objects** in a registry, not hardcoded
  switch statements, so new scenarios compose from reusable building blocks.
- **Deployment is real and uses QuickConnect.** The planner emits a concrete
  Cribl object graph and the executor creates it via the REST API
  (`src/services/criblApi.ts`) scoped to the selected worker group. Validation is
  still derived (labeled), and can be swapped for live metrics later.
- **Idempotent** deploy/reset: objects use stable ids and are upserted
  (POST, then PATCH on conflict), so an SE can safely redeploy/reset repeatedly.
- **Fallback behavior**: if a preferred destination is unavailable, preflight
  drops readiness to `fallback` and the planner preserves the routing story
  using Cribl-native Search/Lake paths.
- Scenarios are **portable**: save a scenario definition (JSON) and hand it to
  another SE/CSE/PS resource, or load one from the landing page.

## How demo data is abstracted from the visible source

This is a **hard product rule**: the app must never present the source as
"datagen." The term exists only in code and plan objects, never in user-facing
copy, labels, or storytelling.

The separation is made explicit in the domain model. Every `DeploymentPlan`
carries a `DemoDataPath` with four distinct layers:

| Layer | Field | Rendered to users? |
|---|---|---|
| Internal generation (Cribl built-in datagen) | `dataPath.internalGeneration` | **Never** |
| Visible source presentation | `dataPath.visibleSource` | Yes |
| Stream listener / source config | `dataPath.streamListener` | Yes |
| Post-ingest route + pipeline behavior | `dataPath.postIngest` | Yes |

Under the hood, Cribl's built-in datagen is the preferred engine for repeatable
sample events (`SampleFeed.method = 'cribl-datagen'`). Those events are looped
through a realistic Stream input so the demo looks and feels like a live source
path. We deliberately do **not** build a separate external fake-data service.

### QuickConnect deployment topology

Deployment creates this object graph in the target worker group, wired with
**QuickConnect** (source `sendToRoutes: false` + `connections[]`):

```
datagen (hidden)  ──▶  loop output (hidden)  ──▶  visible listener source  ──▶  destination(s)
  cribl-datagen         syslog/tcp → 127.0.0.1        syslog/tcp on 0.0.0.0        Splunk / S3 / Lake / ...
                                                                            └────▶  federated Search copy (Cribl Lake)
```

- The **datagen** input generates the sample (`palo_alto_traffic`,
  `sentinel_windowsevents`) and QuickConnects to a **loop output**.
- The **loop output** sends those events to `127.0.0.1:<port>`, where the
  **visible listener source** (a genuine syslog/TCP input) receives them — so in
  the Cribl Sources UI the SE shows a real source, never a generator.
- The visible source QuickConnects to the selected **destinations**, which are
  created with minimal config (they don't need to be live) so the SE can show
  the full source → destination path.

### Processing on the SIEM feed (real Cribl Packs)

The selected **processing profile** processes **only the SIEM QuickConnect
connection** (`connections[].pipeline`); other tiers (Lake, S3, Search) receive
raw data, so the demo shows differentiated, per-destination processing.

- **Pack-backed profiles** install a real Cribl Pack from the Dispensary via
  `POST /m/<group>/packs { source }` (the Cribl Leader downloads the `.crbl`
  server-side — no app `proxies.yml` change needed) and point the SIEM connection
  at `pack:<packId>`. Install is idempotent (already-installed packs are left as
  is). Example: the firewall profile installs
  [`cribl-palo-alto-networks`](https://packs.cribl.io/packs/cribl-palo-alto-networks),
  which parses the PAN-OS CSV traffic logs the demo generates.
- **Custom-pipeline profiles** build a self-contained demo pipeline
  (`demo_pipe_<token>`) that documents the steps, stamps `cribl_demo_processing`,
  and applies a light sampling reduction.

Packs are **not** removed on reset — they're shared, additive resources.

Data-format note: the built-in `palo_alto_traffic` datagen emits authentic PAN-OS
CSV in `_raw`, which the pack matches via its `_raw` regex branch (no `sourcetype`
required). The syslog loop adds an extra header on top of the sample's own header;
the pack still matches and trims it.

### Federated Cribl Search tier

Every deploy also stands up a federated Cribl Search story over the demo data:

- A dedicated **Cribl Lake dataset** (`demo_lake_<token>`) is created under the
  default Lake with **search execution v2**, **acceleration** (auto datatyping /
  field discovery), and — when a prebuilt datatype matches the source — a
  **path-filter datatype fallback** so fields are searchable out of the box.
- A **search copy** output forks the feed into that dataset so it always has data.
- A **saved search** and a **dashboard** are created in the `default_search`
  group, querying `dataset="demo_lake_<token>"`.

These Search artifacts are treated as **soft** on deploy: if any fail to wire up,
the core stream demo still succeeds and reports a warning rather than failing.

Only the `source` and `destination` objects are presented; `datagen` and `loop`
are marked `hidden: true` in the plan and rendered as "internal" on the review
screen.

### Cloud-native destination types

This app targets **Cribl.Cloud** worker groups, which do **not** support
`filesystem` outputs. Destinations therefore use cloud-native output types that
create cleanly without live endpoints:

- **SIEM** (Splunk, Sentinel stand-in) → `splunk`
- **Lake / archive tiers** → `cribl_lake`, pointed at the always-present
  `default_logs` Lake dataset (so creation never depends on a custom dataset)
- **Federated Search copy** → `cribl_lake`, pointed at the per-demo
  `demo_lake_<token>` dataset this app creates
- **Object store** → `s3` (needs only `bucket` + `stagePath`)

### Stream tags (QuickConnect filtering)

The **visible** objects (the source + destinations) carry two `streamtags`:

- `SE-Demo-Launcher` — a global tag on all visible demo assets this app deploys.
- `demo-<scenarioToken>` — a per-scenario tag unique to the selected use
  case + source, so each demo's assets are independently filterable.

The `datagen` and `loop` plumbing are left **untagged** on purpose, so filtering
QuickConnect by these tags shows only the realistic source and its destinations —
never the internal generator.

In the Cribl QuickConnect UI, filter by `SE-Demo-Launcher` to see only demo
assets, or by the scenario tag to isolate a single demo. The tags are stable per
scenario, so redeploys reuse them and reset removes the same objects. The active
tags are shown on the review screen.

> The fetch proxy only works when the app is **installed in Cribl**. Under
> `npm run dev` the API calls cannot reach the Leader; the executor reports this
> per action. Package and install the app to deploy for real.

## Project structure

```
src/
  domain/
    types.ts                 # All interfaces (single source of truth)
    registry/
      useCaseTemplates.ts    # The 3 curated Public Sector scenarios
      sourceProfiles.ts      # Visible source profiles (+ internal SampleFeed)
      presentationModes.ts   # Ingestion presentations
      destinationProfiles.ts # SIEM / Search / Lake / archive / ops targets
      processingProfiles.ts  # Pack-backed & custom pipelines
      overlays.ts            # Sovereignty / PII / compliance overlays
      visualOutcomeProfiles.ts
      runModes.ts            # Lightning / Standard / POV
      index.ts               # Central re-export
  services/
    deploymentPlanner.ts     # Selection -> concrete DeploymentPlan (+ fallback)
    deploymentExecutor.ts    # Mocked orchestration (stub)
    validationService.ts     # Operational post-deploy checks (stub)
    preflightService.ts      # Environment probe + fallback decision (stub)
    resetService.ts          # Idempotent teardown (stub)
    scenarioIo.ts            # Save / load portable scenario definitions
  state/
    LauncherContext.tsx      # Wizard + artifact state
  components/                # AppLayout, Stepper, OptionCard, StatusBadge, TalkTrackPanel
  pages/                     # Landing, Wizard, Review, Validation, Reset
  App.tsx                    # Router shell (basename = window.CRIBL_BASE_PATH)
```

## Extending with new Public Sector use cases

1. Add any new **source profiles** to `registry/sourceProfiles.ts`. Set the
   visible `protocol` / `streamInputKind`, and put the sample mechanism in
   `sampleFeed` (internal only).
2. Add **destinations**, **processing profiles**, **visual outcomes**, or
   **overlays** to their respective registry files as needed.
3. Add a **`UseCaseTemplate`** to `registry/useCaseTemplates.ts` referencing the
   ids above. Provide `defaults` (so Lightning mode can accept-and-go), the
   `compatible*` option sets, `compatibleOverlayIds`, and a `talkTrack`
   (customer problem / what Cribl does / proof point).

No other code changes are required — the wizard, planner, preflight, review, and
validation screens are all data-driven from the registry.

## Development

```bash
npm run dev      # start the Vite dev server
npm run build    # type-check + production build
npm run package  # bump version and create the Cribl app archive
```

See `AGENTS.md` for Cribl App Platform specifics (fetch proxy, KV store,
`config/proxies.yml`, navigation).
