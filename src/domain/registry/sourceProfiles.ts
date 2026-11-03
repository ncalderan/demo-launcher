import type { SourceProfile } from '../types';
import { siCisco, siClaudecode, siF5, siLinux, siPaloaltonetworks } from 'simple-icons';
import crowdstrikeSvgRaw from '../../assets/icons/crowdstrike.svg?raw';
import checkpointPng from '../../assets/icons/checkpoint.png';
import zscalerPng from '../../assets/icons/zscaler.png';
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
import { ciscoAsaEvents, ciscoAsaSampleMeta } from '../samples/ciscoAsa';
import { checkpointEvents, checkpointSampleMeta } from '../samples/checkpoint';
import { crowdstrikeEvents, crowdstrikeSampleMeta } from '../samples/crowdstrike';
import { f5BigipEvents, f5BigipSampleMeta } from '../samples/f5Bigip';
import { zscalerEvents, zscalerSampleMeta } from '../samples/zscaler';

const GENERIC_ICON = { kind: 'generic' as const };

/**
 * Microsoft Windows logo. Not in `simple-icons` (Microsoft OS marks are
 * excluded there) — sourced from draw.io's public icon CDN
 * (icons.diagrams.net), confirmed live and downloaded into the repo so the
 * app has no runtime dependency on an external host for it.
 */
const WINDOWS_ICON = {
  kind: 'brand-svg' as const,
  label: 'Windows',
  hex: '29ABE2',
  svg: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><g opacity="0.3"><path d="M39.5,22.5h-12c-0.3,0-0.5,0.2-0.5,0.5v9.1c0,0.3,0.2,0.5,0.4,0.5l12,1.4h0.1c0.3,0,0.5-0.2,0.5-0.5V23C40,22.7,39.8,22.5,39.5,22.5L39.5,22.5z" fill="currentColor"/><path d="M39.8,8.1C39.7,8,39.6,8,39.4,8l-12,1.4c-0.3,0-0.4,0.2-0.4,0.5V20c0,0.3,0.2,0.5,0.5,0.5h12c0.3,0,0.5-0.2,0.5-0.5V8.5C40,8.4,39.9,8.2,39.8,8.1z" fill="currentColor"/><path d="M24.4,9.8l-10,1.2c-0.3,0-0.4,0.2-0.4,0.5V20c0,0.3,0.2,0.5,0.5,0.5h10c0.3,0,0.5-0.2,0.5-0.5v-9.7C25,10,24.8,9.8,24.4,9.8C24.5,9.8,24.5,9.8,24.4,9.8z" fill="currentColor"/><path d="M24.5,22.5h-10c-0.3,0-0.5,0.2-0.5,0.5v7.5c0,0.3,0.2,0.5,0.4,0.5l10,1.2h0.1c0.3,0,0.5-0.2,0.5-0.5V23C25,22.7,24.8,22.5,24.5,22.5z" fill="currentColor"/></g><path d="M28.8,19.1C28.7,19,28.6,19,28.4,19l-10,1.2c-0.3,0-0.4,0.2-0.4,0.5v7.8c0,0.3,0.2,0.5,0.5,0.5h10c0.3,0,0.5-0.2,0.5-0.5v-9C29,19.4,28.9,19.2,28.8,19.1z M28,28h-9v-6.9l9-1.1V28z" fill="currentColor"/><path d="M15.4,20.5l-8,1C7.2,21.6,7,21.8,7,22v6.5C7,28.8,7.2,29,7.5,29h8c0.3,0,0.5-0.2,0.5-0.5V21C16,20.7,15.8,20.5,15.4,20.5C15.5,20.5,15.5,20.5,15.4,20.5L15.4,20.5z M15,28H8v-5.6l7-0.8V28z" fill="currentColor"/><path d="M15.5,31h-8C7.2,31,7,31.2,7,31.5V38c0,0.3,0.2,0.5,0.4,0.5l8,1h0.1c0.3,0,0.5-0.2,0.5-0.5v-7.5C16,31.2,15.8,31,15.5,31z M15,38.4l-7-0.8V32h7V38.4z" fill="currentColor"/><path d="M28.5,31h-10c-0.3,0-0.5,0.2-0.5,0.5v7.8c0,0.3,0.2,0.5,0.4,0.5l10,1.2h0.1c0.3,0,0.5-0.2,0.5-0.5v-9C29,31.2,28.8,31,28.5,31z M28,39.9l-9-1.1V32h9V39.9z" fill="currentColor"/></svg>',
};

/** CrowdStrike's real falcon mark, provided directly (neither simple-icons nor draw.io had it). */
const CROWDSTRIKE_ICON = {
  kind: 'brand-svg' as const,
  label: 'CrowdStrike',
  hex: 'DA1B1B',
  svg: crowdstrikeSvgRaw.replace(/fill="#da1b1b"/i, 'fill="currentColor"'),
};

/**
 * Check Point's and Zscaler's real logo marks, provided directly (neither
 * simple-icons nor draw.io had them). Raster: not cleanly recolorable,
 * rendered at their own native brand colors like any other third-party mark.
 */
const CHECKPOINT_ICON = { kind: 'brand-image' as const, src: checkpointPng, label: 'Check Point' };
const ZSCALER_ICON = { kind: 'brand-image' as const, src: zscalerPng, label: 'Zscaler' };

/**
 * Visible source profiles. Each describes a realistic protocol/collector path.
 * `sampleFeed` is the only place the under-the-hood sample mechanism is named;
 * it is never rendered in the UI.
 */
export const sourceProfiles: SourceProfile[] = [
  {
    id: 'src-pan-firewall-syslog',
    family: 'syslog',
    icon: { kind: 'brand-svg', svg: siPaloaltonetworks.svg, hex: siPaloaltonetworks.hex, label: siPaloaltonetworks.title },
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
    icon: WINDOWS_ICON,
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
    icon: GENERIC_ICON,
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
    icon: { kind: 'brand-svg', svg: siLinux.svg, hex: siLinux.hex, label: siLinux.title },
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
    icon: { kind: 'brand-svg', svg: siClaudecode.svg, hex: siClaudecode.hex, label: siClaudecode.title },
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
    icon: GENERIC_ICON,
    family: 'security-lake',
    displayName: 'Correlated security telemetry (Cribl Lake)',
    summary:
      'Backdated endpoint, DNS, firewall, identity, and VCS logs modeling a supply-chain compromise, ready for AI Investigator.',
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
  {
    id: 'src-cisco-asa-firewall',
    icon: { kind: 'brand-svg', svg: siCisco.svg, hex: siCisco.hex, label: siCisco.title },
    family: 'syslog',
    displayName: 'Cisco ASA Firewall (syslog)',
    summary: 'Perimeter firewall connection, deny, and VPN logs over syslog.',
    protocol: 'Syslog (RFC3164 over UDP/TCP)',
    streamInputKind: 'syslog',
    loopListenerKind: 'syslog',
    datagenSample: 'cisco_asa',
    defaultPort: 21021,
    sampleSchema: [
      { name: 'action', type: 'string', example: 'Built' },
      { name: 'src', type: 'ip', example: '203.0.113.42' },
      { name: 'dst', type: 'ip', example: '10.14.2.87' },
      { name: 'port', type: 'number', example: '443' },
      { name: 'user', type: 'string', sensitive: true, example: 'a.smith' },
    ],
    compatibleDestinations: ['siem-analytics', 'low-cost-store', 'compliance-archive'],
    parsingAssumptions: [
      '%ASA-#-######: message format',
      'Timestamp taken from syslog header',
      'Action/severity mapped from the ASA message id',
    ],
    sampleFeed: {
      method: 'cribl-datagen',
      internalTemplateRef: 'replay:cisco_asa',
      approxEventsPerSecond: 100,
      maintainerNote:
        'App-shipped Cisco ASA syslog events replayed via a pipeline (datagen used only as a clock) so the data matches the cribl-cisco-asa-cleanup pack.',
    },
    replaySample: {
      events: ciscoAsaEvents,
      sourcetype: ciscoAsaSampleMeta.sourcetype,
      source: ciscoAsaSampleMeta.source,
      index: ciscoAsaSampleMeta.index,
    },
  },
  {
    id: 'src-checkpoint-firewall',
    icon: CHECKPOINT_ICON,
    family: 'syslog',
    displayName: 'Check Point Firewall (syslog)',
    summary: 'Perimeter firewall accept/drop, VPN, and NAT logs over syslog.',
    protocol: 'Syslog (LEA-style key=value)',
    streamInputKind: 'syslog',
    loopListenerKind: 'syslog',
    datagenSample: 'checkpoint_fw',
    defaultPort: 21022,
    sampleSchema: [
      { name: 'action', type: 'string', example: 'accept' },
      { name: 'src', type: 'ip', example: '10.14.2.87' },
      { name: 'dst', type: 'ip', example: '52.10.44.9' },
      { name: 'service', type: 'string', example: '443' },
      { name: 'user', type: 'string', sensitive: true, example: 'a.smith' },
    ],
    compatibleDestinations: ['siem-analytics', 'low-cost-store', 'compliance-archive'],
    parsingAssumptions: [
      'LEA-style key=value syslog payload',
      'Timestamp taken from syslog header',
      'action field drives allow/deny classification',
    ],
    sampleFeed: {
      method: 'cribl-datagen',
      internalTemplateRef: 'replay:checkpoint_fw',
      approxEventsPerSecond: 80,
      maintainerNote:
        'App-shipped Check Point syslog events replayed via a pipeline (datagen used only as a clock) so the data matches the cribl-checkpoint pack.',
    },
    replaySample: {
      events: checkpointEvents,
      sourcetype: checkpointSampleMeta.sourcetype,
      source: checkpointSampleMeta.source,
      index: checkpointSampleMeta.index,
    },
  },
  {
    id: 'src-crowdstrike-falcon',
    icon: CROWDSTRIKE_ICON,
    family: 'security-lake',
    displayName: 'CrowdStrike Falcon (EDR)',
    summary: 'Endpoint detections and process telemetry from CrowdStrike Falcon.',
    protocol: 'JSON over TCP (Falcon Data Replicator-style)',
    streamInputKind: 'tcp',
    loopListenerKind: 'tcp',
    datagenSample: 'crowdstrike_falcon',
    defaultPort: 21023,
    sampleSchema: [
      { name: 'DetectName', type: 'string', example: 'Suspicious Process' },
      { name: 'SeverityName', type: 'string', example: 'High' },
      { name: 'ComputerName', type: 'string', example: 'wks-brown-mbp' },
      { name: 'UserName', type: 'string', sensitive: true, example: 'm.brown' },
      { name: 'LocalIP', type: 'ip', example: '10.9.1.34' },
    ],
    compatibleDestinations: ['siem-analytics', 'low-cost-store', 'operations'],
    parsingAssumptions: [
      'Falcon detection/event JSON records',
      'Severity mapped from SeverityName',
      'Endpoint fields (ComputerName/UserName) flagged for sensitivity review',
    ],
    sampleFeed: {
      method: 'cribl-datagen',
      internalTemplateRef: 'replay:crowdstrike_falcon',
      approxEventsPerSecond: 50,
      maintainerNote:
        'App-shipped CrowdStrike Falcon JSON events replayed via a pipeline (datagen used only as a clock) so the data matches the cribl_crowdstrike pack.',
    },
    replaySample: {
      events: crowdstrikeEvents,
      sourcetype: crowdstrikeSampleMeta.sourcetype,
      source: crowdstrikeSampleMeta.source,
      index: crowdstrikeSampleMeta.index,
    },
  },
  {
    id: 'src-f5-bigip',
    icon: { kind: 'brand-svg', svg: siF5.svg, hex: siF5.hex, label: siF5.title },
    family: 'syslog',
    displayName: 'F5 BIG-IP (LTM/ASM syslog)',
    summary: 'Load balancer health, connection, and WAF-block logs over syslog.',
    protocol: 'Syslog (RFC3164 over UDP/TCP)',
    streamInputKind: 'syslog',
    loopListenerKind: 'syslog',
    datagenSample: 'f5_bigip',
    defaultPort: 21024,
    sampleSchema: [
      { name: 'module', type: 'string', example: 'tmm' },
      { name: 'id', type: 'string', example: '01260013' },
      { name: 'pool', type: 'string', example: '/Common/web_pool' },
      { name: 'status', type: 'string', example: 'up' },
    ],
    compatibleDestinations: ['siem-analytics', 'operations', 'low-cost-store'],
    parsingAssumptions: [
      'F5 module[pid]: id: message format',
      'Timestamp taken from syslog header',
      'ASM lines carry attack-type/blocking fields',
    ],
    sampleFeed: {
      method: 'cribl-datagen',
      internalTemplateRef: 'replay:f5_bigip',
      approxEventsPerSecond: 70,
      maintainerNote:
        'App-shipped F5 BIG-IP syslog events replayed via a pipeline (datagen used only as a clock) so the data matches the cribl-f5-bigip pack.',
    },
    replaySample: {
      events: f5BigipEvents,
      sourcetype: f5BigipSampleMeta.sourcetype,
      source: f5BigipSampleMeta.source,
      index: f5BigipSampleMeta.index,
    },
  },
  {
    id: 'src-zscaler-internet-access',
    icon: ZSCALER_ICON,
    family: 'security-lake',
    displayName: 'Zscaler Internet Access (NSS web log)',
    summary: 'Cloud web proxy allow/block decisions and threat categorization.',
    protocol: 'JSON over TCP (NSS web log feed)',
    streamInputKind: 'tcp',
    loopListenerKind: 'tcp',
    datagenSample: 'zscaler_nss',
    defaultPort: 21025,
    sampleSchema: [
      { name: 'user', type: 'string', sensitive: true, example: 'a.smith@agency.local' },
      { name: 'url', type: 'string', example: 'https://outlook.office.com/mail/' },
      { name: 'action', type: 'string', example: 'Allowed' },
      { name: 'urlcategory', type: 'string', example: 'Business and Economy' },
      { name: 'threatname', type: 'string', example: 'Suspicious_C2_Beacon' },
    ],
    compatibleDestinations: ['siem-analytics', 'low-cost-store', 'operations'],
    parsingAssumptions: [
      'Zscaler NSS web-log JSON records',
      'action field drives allow/block classification',
      'urlcategory/threatname used for risk storytelling',
    ],
    sampleFeed: {
      method: 'cribl-datagen',
      internalTemplateRef: 'replay:zscaler_nss',
      approxEventsPerSecond: 60,
      maintainerNote:
        'App-shipped Zscaler NSS JSON events replayed via a pipeline (datagen used only as a clock) so the data matches the cribl-zscaler pack.',
    },
    replaySample: {
      events: zscalerEvents,
      sourcetype: zscalerSampleMeta.sourcetype,
      source: zscalerSampleMeta.source,
      index: zscalerSampleMeta.index,
    },
  },
];

export const sourceProfileById = new Map(sourceProfiles.map((s) => [s.id, s]));
