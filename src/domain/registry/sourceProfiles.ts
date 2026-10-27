import type { SourceProfile } from '../types';
import {
  windowsSecurityEvents,
  windowsSecuritySampleMeta,
} from '../samples/windowsSecurityEvents';
import {
  linuxSyslogEvents,
  linuxSyslogSampleMeta,
} from '../samples/linuxSyslogEvents';
import {
  claudeCodeTelemetryEvents,
  claudeCodeTelemetryMeta,
} from '../samples/claudeCodeTelemetry';

/**
 * Visible source profiles. Each describes a realistic protocol/collector path.
 * `sampleFeed` is the only place the under-the-hood sample mechanism is named;
 * it is never rendered in the UI.
 */
export const sourceProfiles: SourceProfile[] = [
  {
    id: 'src-pan-firewall-syslog',
    family: 'syslog',
    displayName: 'Palo Alto Firewall (syslog)',
    summary: 'Perimeter firewall traffic and threat logs over syslog.',
    protocol: 'Syslog (RFC5424 over UDP/TCP)',
    streamInputKind: 'syslog',
    loopListenerKind: 'syslog',
    datagenSample: 'palo_alto_traffic',
    defaultPort: 21014,
    sampleSchema: [
      { name: 'src_ip', type: 'ip', example: '10.14.2.87' },
      { name: 'dest_ip', type: 'ip', example: '52.10.44.9' },
      { name: 'action', type: 'string', example: 'allow' },
      { name: 'app', type: 'string', example: 'ssl' },
      { name: 'bytes', type: 'number', example: '18442' },
      { name: 'user', type: 'string', sensitive: true, example: 'jdoe' },
    ],
    compatibleDestinations: ['siem-analytics', 'low-cost-store', 'compliance-archive'],
    parsingAssumptions: [
      'CSV-style PAN-OS TRAFFIC/THREAT payloads',
      'Timestamp taken from syslog header',
      'Severity mapped from PAN-OS log type',
    ],
    sampleFeed: {
      method: 'cribl-datagen',
      internalTemplateRef: 'datagen:palo_alto_traffic',
      approxEventsPerSecond: 120,
      maintainerNote: 'Looped through a syslog source so it presents as a live appliance.',
    },
  },
  {
    id: 'src-windows-security-events',
    family: 'windows-event',
    displayName: 'Windows Server (Security event log)',
    summary: 'Windows Security channel events from domain-joined servers.',
    protocol: 'Windows Event Collector (WEF/WEC)',
    streamInputKind: 'wef',
    loopListenerKind: 'tcp',
    datagenSample: 'sentinel_windowsevents',
    defaultPort: 21015,
    sampleSchema: [
      { name: 'EventID', type: 'number', example: '4624' },
      { name: 'Channel', type: 'string', example: 'Security' },
      { name: 'Computer', type: 'string', example: 'DC01.agency.local' },
      { name: 'TargetUserName', type: 'string', sensitive: true, example: 'a.smith' },
      { name: 'LogonType', type: 'number', example: '3' },
      { name: 'IpAddress', type: 'ip', example: '10.9.1.34' },
    ],
    compatibleDestinations: ['siem-analytics', 'operations', 'low-cost-store'],
    parsingAssumptions: [
      'Windows XML/EVTX event structure',
      'EventID drives category classification',
      'Account fields flagged for sensitivity review',
    ],
    sampleFeed: {
      method: 'cribl-datagen',
      internalTemplateRef: 'replay:windows_security_xml',
      approxEventsPerSecond: 90,
      maintainerNote:
        'App-shipped Windows XML events replayed via a pipeline (datagen used only as a clock) so the data exactly matches the Windows XML pack.',
    },
    replaySample: {
      events: windowsSecurityEvents,
      sourcetype: windowsSecuritySampleMeta.sourcetype,
      source: windowsSecuritySampleMeta.source,
      index: windowsSecuritySampleMeta.index,
    },
  },
  {
    id: 'src-generic-tcp-appliance',
    family: 'tcp',
    displayName: 'Network Appliance (generic TCP)',
    summary: 'Line-delimited telemetry from a generic TCP-emitting appliance.',
    protocol: 'Raw TCP (newline-delimited)',
    streamInputKind: 'tcp',
    loopListenerKind: 'tcp',
    datagenSample: 'palo_alto_traffic',
    defaultPort: 21020,
    sampleSchema: [
      { name: 'ts', type: 'timestamp', example: '2026-07-02T18:00:00Z' },
      { name: 'host', type: 'string', example: 'edge-appliance-03' },
      { name: 'class', type: 'string', example: 'C2' },
      { name: 'region', type: 'string', example: 'gov-east' },
      { name: 'payload', type: 'string', sensitive: true, example: '...' },
    ],
    compatibleDestinations: ['siem-analytics', 'compliance-archive', 'low-cost-store'],
    parsingAssumptions: [
      'Newline-delimited records over a TCP listener',
      'Data class carried in the "class" field',
      'Region used for residency-aware routing',
    ],
    sampleFeed: {
      method: 'cribl-datagen',
      internalTemplateRef: 'datagen:generic_tcp_policy',
      approxEventsPerSecond: 75,
      maintainerNote: 'Looped through a TCP source to present as a real appliance.',
    },
  },
  {
    id: 'src-linux-infra-syslog',
    family: 'linux-infra',
    displayName: 'Linux Server (infra logs)',
    summary: 'OS and service logs from Linux infrastructure over syslog.',
    protocol: 'Syslog (RFC3164)',
    streamInputKind: 'syslog',
    loopListenerKind: 'syslog',
    // Drives the pack mapping (→ cribl-syslog-input). Actual events come from the
    // bundled replay set below (the datagen is only a clock), so the data is real
    // RFC3164 syslog rather than a Cribl built-in sample.
    datagenSample: 'linux_syslog',
    defaultPort: 21016,
    sampleSchema: [
      { name: 'facility', type: 'string', example: 'daemon' },
      { name: 'severity', type: 'string', example: 'info' },
      { name: 'host', type: 'string', example: 'app-node-11' },
      { name: 'process', type: 'string', example: 'sshd' },
      { name: 'message', type: 'string', example: 'Accepted publickey for svc' },
    ],
    compatibleDestinations: ['operations', 'low-cost-store', 'siem-analytics'],
    parsingAssumptions: [
      'RFC3164 syslog header parsing',
      'Facility/severity mapped to standard fields',
      'Process name extracted from tag',
    ],
    sampleFeed: {
      method: 'cribl-datagen',
      internalTemplateRef: 'replay:linux_syslog',
      approxEventsPerSecond: 60,
      maintainerNote:
        'App-shipped RFC3164 syslog events replayed via a pipeline (datagen used only as a clock) so the data matches the Cribl Syslog Input pack and the syslog datatype.',
    },
    replaySample: {
      events: linuxSyslogEvents,
      sourcetype: linuxSyslogSampleMeta.sourcetype,
      source: linuxSyslogSampleMeta.source,
      index: linuxSyslogSampleMeta.index,
    },
  },
  {
    id: 'src-ai-claude-otel',
    family: 'ai-telemetry',
    displayName: 'Claude Code (OpenTelemetry)',
    summary: 'AI coding-agent telemetry (tokens, cost, models, prompts) over OTel.',
    protocol: 'OpenTelemetry (OTLP)',
    streamInputKind: 'otel',
    // Presented as an OpenTelemetry receiver; fed internally over a tcpjson loop
    // carrying the app-shipped Claude Code events (the datagen is only a clock).
    loopListenerKind: 'tcp',
    // Drives the (no-pack) enrichment path. Actual events come from the bundled
    // replay set below; the datagen sample is only the heartbeat clock.
    datagenSample: 'claude_code_otel',
    defaultPort: 21017,
    sampleSchema: [
      { name: 'event_name', type: 'string', example: 'claude_code.api_request' },
      { name: 'user_email', type: 'string', sensitive: true, example: 'a.smith@bazookatron.io' },
      { name: 'model', type: 'string', example: 'claude-sonnet-4-5' },
      { name: 'input_tokens', type: 'number', example: '8200' },
      { name: 'output_tokens', type: 'number', example: '2600' },
      { name: 'cost_usd', type: 'number', example: '0.184' },
      { name: 'subject', type: 'string', example: 'Refactoring' },
    ],
    compatibleDestinations: ['low-cost-store', 'operations'],
    parsingAssumptions: [
      'OTel log/event records (api_request, user_prompt, tool_decision, tool_result)',
      'Token/cost breakdown carried per api_request event',
      'Prompt subject classified from user_prompt text at ingest',
    ],
    sampleFeed: {
      method: 'cribl-datagen',
      internalTemplateRef: 'replay:claude_code_otel',
      approxEventsPerSecond: 40,
      maintainerNote:
        'App-shipped Claude Code OTel events replayed via a pipeline (datagen used only as a clock), then normalized + subject-classified by the enrichment pipeline before landing in the Lake dataset.',
    },
    replaySample: {
      events: claudeCodeTelemetryEvents,
      sourcetype: claudeCodeTelemetryMeta.sourcetype,
      source: claudeCodeTelemetryMeta.source,
      index: claudeCodeTelemetryMeta.index,
    },
  },
  {
    id: 'src-security-lake-backfill',
    family: 'security-lake',
    displayName: 'Correlated security telemetry (Cribl Lake)',
    summary:
      'Historically-backfilled endpoint, DNS, firewall, identity, and VCS logs modeling a supply-chain compromise, written to Cribl Lake for AI Investigator federated search.',
    protocol: 'Cribl Lake Direct Access (HTTP NDJSON)',
    streamInputKind: 'tcp',
    loopListenerKind: 'tcp',
    // No live datagen/pack — this source backfills historical events directly into
    // Lake datasets. The value is the app-authored, correlated incident data.
    datagenSample: 'security_incident',
    defaultPort: 0,
    sampleSchema: [
      { name: '_time', type: 'timestamp', example: '2026-06-30T14:22:11Z' },
      { name: 'user', type: 'string', sensitive: true, example: 'm.brown' },
      { name: 'host', type: 'string', example: 'wks-brown-mbp' },
      { name: 'process_name', type: 'string', example: 'node' },
      { name: 'file_path', type: 'string', sensitive: true, example: '~/.aws/credentials' },
      { name: 'domain', type: 'string', example: 'telemetry-sync-eu.mcp-labs.ro' },
      { name: 'dest_country', type: 'string', example: 'RO' },
    ],
    compatibleDestinations: ['low-cost-store', 'siem-analytics'],
    parsingAssumptions: [
      'Structured JSON events with top-level _time (epoch seconds)',
      'OCSF-style entity fields shared across sources (user, host, src_ip, dest_ip, domain)',
      'Federated-searchable in Cribl Search directly from the Lake datasets',
    ],
    sampleFeed: {
      method: 'cribl-datagen',
      internalTemplateRef: 'backfill:security_incident',
      approxEventsPerSecond: 0,
      maintainerNote:
        'App-authored, correlated multi-source incident backfilled into Cribl Lake via Direct Access HTTP ingest (see src/domain/samples/security).',
    },
  },
];

export const sourceProfileById = new Map(sourceProfiles.map((s) => [s.id, s]));
