import type { DestinationProfile } from '../types';
import { siElasticsearch, siSplunk } from 'simple-icons';
import azureSvgRaw from '../../assets/icons/azure.svg?raw';

const GENERIC_ICON = { kind: 'generic' as const };
const SPLUNK_ICON = {
  kind: 'brand-svg' as const,
  svg: siSplunk.svg,
  hex: siSplunk.hex,
  label: siSplunk.title,
};
const ELASTIC_ICON = {
  kind: 'brand-svg' as const,
  svg: siElasticsearch.svg,
  hex: siElasticsearch.hex,
  label: siElasticsearch.title,
};
/**
 * Microsoft Sentinel has no dedicated mark in simple-icons or draw.io's icon
 * search — Azure (the platform Sentinel runs on) is the closest real logo
 * available, used as a stand-in rather than inventing a Sentinel-specific
 * mark.
 */
const SENTINEL_ICON = {
  kind: 'brand-svg' as const,
  svg: azureSvgRaw,
  hex: '2075B8',
  label: 'Microsoft Azure (Sentinel runs on Azure; no dedicated Sentinel mark found)',
};

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
    icon: SPLUNK_ICON,
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
    icon: SENTINEL_ICON,
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
    icon: GENERIC_ICON,
    role: 'operations',
    displayName: 'Federated Search (Cribl Lake)',
    summary: 'Search data in place over Cribl Lake — no separate indexing step, always available.',
    technology: 'Cribl Search',
    costTier: 'low',
    // Honest naming: this is federated search over a Cribl Lake dataset, the
    // same mechanism as dst-cribl-lake below — NOT a Lakehouse-accelerated
    // search engine. Renamed from "Cribl Search (operational subset)", which
    // implied otherwise.
    criblOutput: {
      type: 'cribl_lake',
      config: {
        destPath: DEFAULT_LAKE_DATASET,
        stagePath: LAKE_STAGE_PATH,
        awsAuthenticationMethod: 'auto',
        compress: 'gzip',
        description: 'Federated Search (Cribl Lake)',
      },
    },
  },
  {
    id: 'dst-cribl-lake',
    icon: GENERIC_ICON,
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
    // No clean, directly-downloadable AWS S3 logo found (draw.io only had an
    // internal diagram-only stencil, no exportable SVG URL) — generic
    // fallback rather than a mismatched/guessed mark.
    icon: GENERIC_ICON,
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
    icon: GENERIC_ICON,
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
    icon: ELASTIC_ICON,
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
