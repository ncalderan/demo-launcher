import type { SearchEngine } from '../types';

/**
 * Selectable Cribl Search engines the AI-telemetry demo can accelerate its Lake
 * dataset onto (Lakehouse). `quick_search` is the engine shipped in our pack and
 * is the default. The list is intentionally small and static; an SE can point at
 * whichever provisioned engine exists in the target org. Attaching a dataset to
 * an engine is a best-effort acceleration step — the dataset is fully searchable
 * in Cribl Search regardless of whether acceleration is available.
 */
export const searchEngines: SearchEngine[] = [
  {
    id: 'quick_search',
    displayName: 'quick_search (pack engine)',
    summary: 'The engine shipped in our pack — default for the AI-telemetry demo.',
  },
  {
    id: 'palo',
    displayName: 'palo',
    summary: 'Existing engine used by other datasets; select to co-locate acceleration.',
  },
];

export const searchEngineById = new Map(searchEngines.map((e) => [e.id, e]));

export const DEFAULT_SEARCH_ENGINE_ID = 'quick_search';
