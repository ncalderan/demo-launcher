import type { ProcessingProfile } from '../types';

/** Dispensary download URL for a Cribl-authored Pack id. */
const packUrl = (id: string) => `https://packs.cribl.io/dl/${id}/latest/${id}-latest.crbl`;

/**
 * Real Cribl Packs keyed by the source's datagen sample. The pack is chosen from
 * the DATA, not the processing step: whatever source (sample) the SE picks, its
 * matching Cribl Pack is installed and applied to the SIEM feed. Samples not
 * listed here fall back to a custom demo pipeline.
 */
export const packForSample: Record<string, { id: string; source: string }> = {
  palo_alto_traffic: { id: 'cribl-palo-alto-networks', source: packUrl('cribl-palo-alto-networks') },
  // Maintained Windows XML pack (the older `cribl-windows-events` is deprecated).
  // Not published on the Dispensary `dl` path, so we pin the GitHub release. The
  // installed pack id equals the manifest `name` (underscored), which is what the
  // `pack:<id>` reference and idempotency check must use.
  sentinel_windowsevents: {
    id: 'cribl_splunk_forwarder_windows_xml_events_to_json',
    source:
      'https://github.com/criblpacks/cribl-splunk-forwarder-windows-xml-events-to-json/releases/download/v1.0.6/cribl-splunk-forwarder-windows-xml-events-to-json-99457b72-v1.0.6.crbl',
  },
  linux_syslog: { id: 'cribl-syslog-input', source: packUrl('cribl-syslog-input') },
  generic_tcp_policy: { id: 'cribl-syslog-input', source: packUrl('cribl-syslog-input') },
};

/** Resolve the real Cribl Pack that matches a source's datagen sample, if any. */
export function packForDatagenSample(
  sample: string,
): { id: string; source: string } | undefined {
  return packForSample[sample];
}

/**
 * Prebuilt Cribl Search datatype id that matches each source's data. Assigned to
 * the demo's Cribl Lake dataset (via search-execution v2 path filters) so events
 * are classified and parsed at search time — e.g. Palo Alto traffic resolves to
 * `pan_traffic` (source_ip, action, bytes, …) instead of generic `cribl_json`.
 */
export const datatypeForSample: Record<string, string> = {
  palo_alto_traffic: 'pan_traffic',
  linux_syslog: 'syslog',
  generic_tcp_policy: 'pan_traffic',
  sentinel_windowsevents: 'windows',
};

/** Resolve the Cribl Search datatype id that matches a source's data, if any. */
export function datatypeForDatagenSample(sample: string): string | undefined {
  return datatypeForSample[sample];
}

/**
 * Cribl Lake "breaker ruleset" that parses each source's raw events into named
 * fields at search time (and stamps a `datatype`). Assigned to the demo's Lake
 * dataset via the `breakerRulesets` field so, e.g., Palo Alto traffic resolves
 * to source_ip / destination_ip / application / action / bytes (datatype
 * `pan_traffic`) instead of raw CSV in `_raw`. Verified against the live
 * workspace, where the demo dataset carries `breakerRulesets: ["Palo Alto
 * Datatypes"]` and returns those parsed fields.
 */
export const breakerRulesetForSample: Record<string, string> = {
  palo_alto_traffic: 'Palo Alto Datatypes',
  generic_tcp_policy: 'Palo Alto Datatypes',
};

/** Resolve the Lake breaker ruleset that parses a source's data, if any. */
export function breakerRulesetForDatagenSample(sample: string): string | undefined {
  return breakerRulesetForSample[sample];
}

export const processingProfiles: ProcessingProfile[] = [
  {
    id: 'proc-pack-firewall-optimization',
    kind: 'pack-backed',
    displayName: 'Palo Alto Networks Pack',
    summary:
      'Official Cribl Pack that parses, trims, and enriches Palo Alto firewall logs.',
    packRef: 'cribl-palo-alto-networks',
    pack: packForSample.palo_alto_traffic,
    steps: [
      'Parse PAN-OS CSV TRAFFIC/THREAT/SYSTEM events and trim the syslog header',
      'Add Splunk-style metadata (index, source, sourcetype, host)',
      'Reduce events by dropping future_use and redundant time fields',
    ],
    themes: ['cost-control', 'telemetry-tiering'],
  },
  {
    id: 'proc-pack-windows-normalization',
    kind: 'pack-backed',
    displayName: 'Microsoft Windows Events Pack',
    summary:
      'Official Cribl Pack that parses Windows XML events to JSON and shrinks event size (CIM-compatible).',
    packRef: 'cribl_splunk_forwarder_windows_xml_events_to_json',
    pack: packForSample.sentinel_windowsevents,
    steps: [
      'Parse Windows XML (WEC/WEF/Sysmon) events into structured JSON',
      'Extract EventID, Channel, and account/host fields (CIM-compatible)',
      'Reduce event size (typically 30–50%) while keeping key fields',
    ],
    themes: ['dual-use-visibility', 'telemetry-tiering'],
  },
  {
    id: 'proc-pack-syslog-input',
    kind: 'pack-backed',
    displayName: 'Cribl Syslog Input Pack',
    summary: 'Official Cribl Pack that parses and shapes generic syslog senders.',
    packRef: 'cribl-syslog-input',
    pack: packForSample.linux_syslog,
    steps: [
      'Parse RFC3164/RFC5424 syslog headers and structured data',
      'Extract facility, severity, host, and app/process fields',
      'Normalize timestamps and reduce redundant fields',
    ],
    themes: ['telemetry-tiering', 'operational-resilience'],
  },
  {
    id: 'proc-custom-mask-reduce',
    kind: 'custom-pipeline',
    displayName: 'Custom pipeline: mask & reduce',
    summary: 'Purpose-built pipeline that masks sensitive fields and reduces volume.',
    steps: [
      'Detect and mask PII/sensitive fields',
      'Reduce payload to required subset of fields',
      'Route by data class / region for residency',
    ],
    themes: ['pii-aware-handling', 'controlled-routing', 'cost-control'],
  },
  {
    id: 'proc-custom-policy-routing',
    kind: 'custom-pipeline',
    displayName: 'Custom pipeline: policy routing',
    summary: 'Routes events by policy class while keeping an in-region copy.',
    steps: [
      'Classify events by data class and region',
      'Forward only required subsets downstream',
      'Keep a local compliance copy in-region',
    ],
    themes: ['controlled-routing', 'operational-resilience'],
  },
  {
    id: 'proc-security-backfill',
    kind: 'custom-pipeline',
    displayName: 'Historical backfill (author-time shaping)',
    summary:
      'Events are shaped by the app-side generators (OCSF-style fields, backdated _time) and written straight to Cribl Lake — no in-stream pipeline needed.',
    steps: [
      'Author correlated multi-source events with backdated _time',
      'Write NDJSON to Cribl Lake datasets via Direct Access HTTP',
      'Expose as federated Search datasets for the AI Investigator',
    ],
    themes: ['operational-resilience'],
  },
  {
    id: 'proc-custom-otel-enrich',
    kind: 'custom-pipeline',
    displayName: 'Custom pipeline: OTel AI enrichment',
    summary:
      'Parses Claude Code OTel events, derives token totals/cost, and classifies the prompt subject.',
    pipelineTemplate: 'otel-enrich',
    steps: [
      'Parse OTel JSON and normalize attributes to flat fields',
      'Derive total_tokens and per-event cost fields',
      'Classify prompt subject from user_prompt text',
    ],
    themes: ['telemetry-tiering', 'operational-resilience'],
  },
];

export const processingProfileById = new Map(processingProfiles.map((p) => [p.id, p]));
