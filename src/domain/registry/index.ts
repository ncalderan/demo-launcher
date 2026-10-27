/**
 * Central registry of all demo building blocks. Import from here so pages and
 * services depend on a single, structured source of truth rather than scattered
 * imports or hardcoded switch statements.
 */
export {
  useCaseTemplates,
  useCaseTemplateById,
} from './useCaseTemplates';
export { sourceProfiles, sourceProfileById } from './sourceProfiles';
export { presentationModes, presentationModeById } from './presentationModes';
export {
  destinationProfiles,
  destinationProfileById,
  FALLBACK_DESTINATION_IDS,
} from './destinationProfiles';
export { runModes, runModeById } from './runModes';
export { policyOverlays, policyOverlayById } from './overlays';
export {
  processingProfiles,
  processingProfileById,
  packForDatagenSample,
  datatypeForDatagenSample,
  breakerRulesetForDatagenSample,
} from './processingProfiles';
export {
  visualOutcomeProfiles,
  visualOutcomeProfileById,
} from './visualOutcomeProfiles';
export {
  searchEngines,
  searchEngineById,
  DEFAULT_SEARCH_ENGINE_ID,
} from './searchEngines';
