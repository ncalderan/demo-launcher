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
    id: 'viz-ai-telemetry',
    kind: 'dashboard',
    displayName: 'AI telemetry dashboards (Overview, Users, Subjects)',
    summary: 'Cost, token, adoption, and usage dashboards over Claude Code OTel telemetry.',
    themes: ['telemetry-tiering', 'cost-control', 'operational-resilience'],
    assets: [
      'Overview: token & cost trends, model mix, top users',
      'Users & Teams: per-user tokens, cost, sessions',
      'Subjects: what the org is building',
    ],
  },
];

export const visualOutcomeProfileById = new Map(
  visualOutcomeProfiles.map((v) => [v.id, v]),
);
