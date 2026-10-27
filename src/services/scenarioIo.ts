import type { SavedScenario, ScenarioSelection } from '../domain/types';
import { useCaseTemplateById } from '../domain/registry';

/**
 * Portable scenario definitions so an SE can hand a demo to another SE/CSE/PS
 * resource without rebuilding it. Kept as plain JSON with a schema version.
 */

export function toSavedScenario(
  selection: ScenarioSelection,
  name?: string,
  notes?: string,
): SavedScenario {
  const useCase = useCaseTemplateById.get(selection.useCaseId);
  return {
    schemaVersion: 1,
    savedAt: new Date().toISOString(),
    name: name ?? useCase?.title ?? 'Untitled demo',
    notes,
    selection,
  };
}

export function serializeScenario(scenario: SavedScenario): string {
  return JSON.stringify(scenario, null, 2);
}

/** Parse and validate a saved scenario. Throws on malformed/unknown input. */
export function parseScenario(raw: string): SavedScenario {
  const data = JSON.parse(raw) as Partial<SavedScenario>;
  if (data.schemaVersion !== 1 || !data.selection) {
    throw new Error('Unsupported or invalid scenario file.');
  }
  if (!useCaseTemplateById.has(data.selection.useCaseId)) {
    throw new Error(`Unknown use case: ${data.selection.useCaseId}`);
  }
  return data as SavedScenario;
}

/** Trigger a browser download of the scenario JSON. */
export function downloadScenario(scenario: SavedScenario): void {
  const blob = new Blob([serializeScenario(scenario)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const safeName = scenario.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const a = document.createElement('a');
  a.href = url;
  a.download = `demo-scenario-${safeName || 'export'}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
