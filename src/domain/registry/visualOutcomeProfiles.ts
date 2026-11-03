import type { VisualOutcomeProfile } from '../types';

export const visualOutcomeProfiles: VisualOutcomeProfile[] = [
  {
    id: 'viz-dual-feed',
    kind: 'dashboard',
    displayName: 'Dual-feed comparison dashboard',
    summary: 'Same telemetry feeding two SIEM paths, side by side, uninterrupted.',
    themes: ['migration-evaluation', 'operational-resilience'],
    assets: ['Current vs target feed volume', 'Field parity check', 'No-interruption timeline'],
  },
  {
    id: 'viz-volume-reduction',
    kind: 'dashboard',
    displayName: 'Volume reduction dashboard',
    summary: 'Before/after ingest volume and estimated SIEM savings.',
    themes: ['cost-control', 'telemetry-tiering'],
    assets: ['Ingest volume (before/after)', 'Estimated monthly savings', 'Routed event split'],
  },
  {
    id: 'viz-routing-split',
    kind: 'routing-summary',
    displayName: 'Routed event split summary',
    summary: 'Where events went and why, by route and destination.',
    themes: ['telemetry-tiering', 'controlled-routing'],
    assets: ['Events by destination', 'Route hit counts', 'Retained searchable subset'],
  },
  {
    id: 'viz-dual-use',
    kind: 'dashboard',
    displayName: 'Dual-use IT & Security views',
    summary: 'Parallel SOC and operations views over one shared stream.',
    themes: ['dual-use-visibility', 'operational-resilience'],
    assets: ['Security overview', 'Operations / troubleshooting view', 'Shared source lineage'],
  },
  {
    id: 'viz-pii-handling',
    kind: 'data-quality-summary',
    displayName: 'PII handling summary',
    summary: 'Fields detected, masked, and routed for compliant handling.',
    themes: ['pii-aware-handling'],
    assets: ['Sensitive fields detected', 'Masked field counts', 'Compliance routing proof'],
  },
  {
    id: 'viz-controlled-routing',
    kind: 'routing-summary',
    displayName: 'Controlled routing proof',
    summary: 'Proof of policy-driven routing and differentiated storage.',
    themes: ['controlled-routing', 'operational-resilience'],
    assets: ['Routing by data class', 'In-region copy confirmation', 'Downstream subset view'],
  },
  {
    id: 'viz-ai-investigation',
    kind: 'saved-search',
    displayName: 'AI Investigator reconstruction',
    summary:
      'Cribl Search AI Investigator reconstructs the supply-chain compromise from the federated Lake datasets — install → credential theft → C2 egress → token misuse.',
    themes: ['operational-resilience', 'dual-use-visibility'],
    assets: [
      'Seed SIEM alert (EDR sensitive-file access)',
      'Investigator timeline across endpoint/dns/firewall/identity/vcs',
      'Verdict: users with sensitive-file access, compromised machines, worst-affected user',
    ],
  },
  {
    id: 'viz-lakehouse-dashboard',
    kind: 'dashboard',
    displayName: 'Source-matched Lakehouse dashboard',
    summary:
      'A real Cribl Search dashboard, tailored to whichever source was routed into the Lakehouse engine — networking panels for a firewall, event/code-monitoring panels for Windows, and so on.',
    themes: ['operational-resilience', 'telemetry-tiering'],
    assets: [
      'Volume/activity over time',
      'Allow-deny or severity split',
      'Top talkers / top affected hosts or users',
      'Recent events, source-specific fields',
    ],
  },
  {
    id: 'viz-ai-telemetry',
    kind: 'dashboard',
    displayName: "The real AI Observability app's own dashboards",
    summary:
      "Genuine Claude Code OTel telemetry, normalized by the app's own ingestion pack and shown in its real Usage & Cost / Sessions & Traces / Top Models panels — not a custom recreation.",
    themes: ['telemetry-tiering', 'cost-control', 'operational-resilience'],
    assets: [
      'Usage & Cost: spend trends, token consumption, top users and models',
      'Sessions & Traces: filterable session list, full prompt/response/tool-call payloads',
      'Top Models: model mix and adoption across the org',
    ],
  },
];

export const visualOutcomeProfileById = new Map(
  visualOutcomeProfiles.map((v) => [v.id, v]),
);
