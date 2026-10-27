import type { DestinationProfile } from '../types';

/**
 * Destination profiles. Each carries a `criblOutput` template — the actual Cribl
 * output kind + minimal config so the destination saves cleanly. These do NOT
 * need to be live endpoints; they exist so the SE can show a real destination
 * and QuickConnect wiring. Placeholder hosts/buckets are intentional.
 *
 * IMPORTANT: this app targets Cribl.Cloud worker groups, which do NOT support
 * `filesystem` outputs. Cloud-native output types are used instead:
 *   - `splunk`      → SIEM destinations (create without live endpoints)
 *   - `cribl_lake`  → Lake/Search/archive tiers (point at the always-present
 *                     `default_logs` Lake dataset so creation never depends on
 *                     a custom dataset existing)
 *   - `s3`          → object-store archive (needs only bucket + stagePath)
 */
const LAKE_STAGE_PATH = '$CRIBL_HOME/state/outputs/staging';
const DEFAULT_LAKE_DATASET = 'default_logs';

export const destinationProfiles: DestinationProfile[] = [
  {
    id: 'dst-siem-current',
    role: 'siem-analytics',
    displayName: 'Current SIEM (Splunk)',
    summary: 'Existing security analytics platform — the incumbent in a migration.',
    technology: 'Splunk',
    costTier: 'high',
    criblOutput: {
      type: 'splunk',
      config: { host: '127.0.0.1', port: 9997, authType: 'manual', authToken: '', tls: { disabled: true } },
    },
  },
  {
    id: 'dst-siem-target',
    role: 'siem-analytics',
    displayName: 'Target SIEM (Microsoft Sentinel)',
    summary: 'Evaluation/target analytics platform for a dual-feed migration.',
    technology: 'Microsoft Sentinel',
    costTier: 'high',
    // Real Microsoft Sentinel output (Log Ingestion API via a Data Collection
    // Rule). Placeholder Azure AD / DCR values let it save cleanly without live
    // credentials — Cribl does not test connectivity on save — so the SE can
    // show a genuine Sentinel destination in the migration story.
    criblOutput: {
      type: 'sentinel',
      config: {
        authType: 'oauth',
        endpointURLConfiguration: 'ID',
        dceEndpoint: 'https://demo-dce.eastus.ingest.monitor.azure.com',
        dcrID: 'dcr-0000000000000000demo',
        streamName: 'Custom-DemoLogs',
        loginUrl:
          'https://login.microsoftonline.com/demo-tenant-id/oauth2/v2.0/token',
        secret: 'demo-not-live',
        // client_id is a JS expression field — wrap the constant in quotes so it
        // is treated as a string literal (an unquoted value with leading zeros
        // is parsed as an illegal octal literal in strict mode).
        client_id: "'demo-sentinel-client-id'",
        description: 'Microsoft Sentinel (demo target)',
      },
    },
  },
  {
    id: 'dst-cribl-search',
    role: 'operations',
    displayName: 'Cribl Search (operational subset)',
    summary: 'Search data in place — a Cribl-native, always-available proof path.',
    technology: 'Cribl Search',
    costTier: 'low',
    // Searchable subset lands in a Cribl Lake dataset (queried via Cribl Search).
    criblOutput: {
      type: 'cribl_lake',
      config: {
        destPath: DEFAULT_LAKE_DATASET,
        stagePath: LAKE_STAGE_PATH,
        awsAuthenticationMethod: 'auto',
        compress: 'gzip',
        description: 'Cribl Search (operational subset)',
      },
    },
  },
  {
    id: 'dst-cribl-lake',
    role: 'low-cost-store',
    displayName: 'Cribl Lake (retention)',
    summary: 'Low-cost, searchable retention for tiered telemetry.',
    technology: 'Cribl Lake',
    costTier: 'low',
    criblOutput: {
      type: 'cribl_lake',
      config: {
        destPath: DEFAULT_LAKE_DATASET,
        stagePath: LAKE_STAGE_PATH,
        awsAuthenticationMethod: 'auto',
        compress: 'gzip',
        description: 'Cribl Lake (retention)',
      },
    },
  },
  {
    id: 'dst-lake-s3',
    role: 'low-cost-store',
    displayName: 'Object store (Amazon S3)',
    summary: 'Inexpensive archive-style retention for lower-priority data.',
    technology: 'Amazon S3',
    costTier: 'low',
    criblOutput: {
      type: 's3',
      config: {
        bucket: 'cribl-demo-archive',
        stagePath: LAKE_STAGE_PATH,
        awsAuthenticationMethod: 'auto',
        destPath: '',
        compress: 'gzip',
      },
    },
  },
  {
    id: 'dst-compliance-local',
    role: 'compliance-archive',
    displayName: 'Sovereign archive (in-region)',
    summary: 'In-region compliance copy that never leaves the boundary.',
    technology: 'Cribl Lake (in-region)',
    costTier: 'low',
    // In-region compliance copy kept in a Cribl Lake dataset (stays in the
    // Cribl.Cloud region). Filesystem is unavailable in cloud groups.
    criblOutput: {
      type: 'cribl_lake',
      config: {
        destPath: DEFAULT_LAKE_DATASET,
        stagePath: LAKE_STAGE_PATH,
        awsAuthenticationMethod: 'auto',
        compress: 'gzip',
        description: 'Sovereign archive (in-region)',
      },
    },
  },
  {
    id: 'dst-ops-elastic',
    role: 'operations',
    displayName: 'Operations analytics (Elasticsearch)',
    summary: 'Troubleshooting and IT operations destination.',
    technology: 'Elasticsearch',
    costTier: 'medium',
    // Demo stand-in: a Cribl Lake dataset branded as Elasticsearch to guarantee
    // clean creation in a cloud group without a live cluster.
    criblOutput: {
      type: 'cribl_lake',
      config: {
        destPath: DEFAULT_LAKE_DATASET,
        stagePath: LAKE_STAGE_PATH,
        awsAuthenticationMethod: 'auto',
        compress: 'gzip',
        description: 'Operations analytics (Elasticsearch stand-in)',
      },
    },
  },
];

export const destinationProfileById = new Map(destinationProfiles.map((d) => [d.id, d]));

/** Cribl-native destinations used as always-available fallback targets. */
export const FALLBACK_DESTINATION_IDS = ['dst-cribl-search', 'dst-cribl-lake'];
