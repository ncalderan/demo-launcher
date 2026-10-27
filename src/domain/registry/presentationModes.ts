import type { PresentationMode } from '../types';

/** Realistic ingestion presentations. Deliberately never references a generator. */
export const presentationModes: PresentationMode[] = [
  {
    id: 'syslog-listener',
    displayName: 'Syslog listener',
    summary: 'Events arrive on a syslog listener, as from a real appliance.',
    appliesTo: ['syslog', 'linux-infra'],
    listenerType: 'Syslog (UDP/TCP)',
  },
  {
    id: 'tcp-listener',
    displayName: 'TCP listener',
    summary: 'Events stream in over a raw TCP listener.',
    appliesTo: ['tcp'],
    listenerType: 'Raw TCP',
  },
  {
    id: 'windows-event-collector',
    displayName: 'Windows event collector',
    summary: 'Windows events collected via a WEC-style forwarding path.',
    appliesTo: ['windows-event'],
    listenerType: 'Windows Event Collector',
  },
  {
    id: 'file-monitor',
    displayName: 'File / directory monitor',
    summary: 'Log files monitored and tailed from a watched directory.',
    appliesTo: ['linux-infra', 'syslog'],
    listenerType: 'File monitor',
  },
  {
    id: 'otel-listener',
    displayName: 'OpenTelemetry receiver',
    summary: 'Telemetry arrives on an OpenTelemetry (OTLP) receiver.',
    appliesTo: ['ai-telemetry'],
    listenerType: 'OpenTelemetry (OTLP)',
  },
  {
    id: 'lake-backfill',
    displayName: 'Historical Cribl Lake backfill',
    summary:
      'Historically-timestamped events are written straight into Cribl Lake datasets (Direct Access HTTP), ready for federated search.',
    appliesTo: ['security-lake'],
    listenerType: 'Cribl Lake (Direct Access HTTP)',
  },
];

export const presentationModeById = new Map(presentationModes.map((p) => [p.id, p]));
