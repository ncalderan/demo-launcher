/**
 * AI Investigator security demo — bundled event generators + environment model.
 * See ./environment.ts (people/hosts/C2 + private ground truth) and
 * ./generators.ts (per-feed backdated NDJSON with realism).
 */
export {
  buildEnvironment,
  buildGroundTruth,
  type Environment,
  type GroundTruth,
  type Developer,
} from './environment';
export {
  SECURITY_FEEDS,
  SECURITY_DATASET_META,
  SECURITY_DATASET_ID,
  SECURITY_DATASET_IDS,
  buildIncidentData,
  generateSecurityFeed,
  type SecurityFeed,
  type SecurityDatasetMeta,
  type IncidentData,
} from './generators';
