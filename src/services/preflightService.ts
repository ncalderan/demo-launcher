import type {
  EnvironmentCapabilities,
  PreflightCheck,
  PreflightResult,
  ScenarioSelection,
  WorkerGroupRef,
} from '../domain/types';
import { destinationProfileById } from '../domain/registry';
import { listWorkerGroups } from './criblApi';

/** Fallback group list when the API is unreachable (e.g. dev preview). */
const FALLBACK_GROUPS: WorkerGroupRef[] = [{ id: 'default', name: 'default' }];

/** Fetch Stream worker groups, falling back to a default when unreachable. */
export async function fetchWorkerGroups(): Promise<WorkerGroupRef[]> {
  try {
    const groups = await listWorkerGroups();
    return groups.length > 0 ? groups : FALLBACK_GROUPS;
  } catch {
    return FALLBACK_GROUPS;
  }
}

/**
 * Preflight service.
 *
 * STUB: v1 mocks environment probing. When wired to Cribl, replace
 * `probeEnvironment` with real capability discovery (e.g. list configured
 * outputs via `/system/outputs`, and confirm Search/Lake availability).
 *
 * Fallback rule: Cribl-native paths (Stream/Search/Lake) are always available.
 * If a selected external destination is missing, the demo can still run in
 * 'fallback' readiness using a Search/Lake-centered proof path.
 */

/**
 * Flip to simulate an environment missing external destinations, to exercise
 * the fallback path in a demo. Default keeps the happy path clean.
 */
const SIMULATE_MISSING_EXTERNAL = false;

const CRIBL_NATIVE_TECH = ['Cribl Stream', 'Cribl Search', 'Cribl Lake'];

export function probeEnvironment(): EnvironmentCapabilities {
  if (SIMULATE_MISSING_EXTERNAL) {
    return {
      products: ['stream', 'search', 'lake'],
      destinationTech: [...CRIBL_NATIVE_TECH],
    };
  }
  return {
    products: ['stream', 'search', 'lake'],
    destinationTech: [
      ...CRIBL_NATIVE_TECH,
      'Splunk',
      'Microsoft Sentinel',
      'Amazon S3',
      'Elasticsearch',
      'Local filesystem',
    ],
  };
}

export function runPreflight(
  selection: ScenarioSelection,
  capabilities: EnvironmentCapabilities = probeEnvironment(),
): PreflightResult {
  const checks: PreflightCheck[] = [];

  checks.push({
    id: 'pf-group',
    label: `Target worker group — ${selection.groupId}`,
    status: 'ok',
    detail: 'Source, QuickConnect, and destinations will be created in this group.',
  });

  checks.push({
    id: 'pf-routing',
    label: 'Routing mechanism — QuickConnect',
    status: 'ok',
    detail: 'Source connects directly to destinations via QuickConnect (no Routes).',
  });

  checks.push({
    id: 'pf-stream',
    label: 'Cribl Stream available',
    status: capabilities.products.includes('stream') ? 'ok' : 'missing',
    detail: 'Required to stand up the source listener and QuickConnect.',
  });

  const destinations = selection.destinationIds
    .map((id) => destinationProfileById.get(id))
    .filter((d): d is NonNullable<typeof d> => Boolean(d));

  let anyMissing = false;
  for (const dest of destinations) {
    const present = capabilities.destinationTech.includes(dest.technology);
    if (!present) anyMissing = true;
    checks.push({
      id: `pf-dest-${dest.id}`,
      label: `Destination available — ${dest.displayName}`,
      status: present ? 'ok' : 'warn',
      detail: present
        ? `${dest.technology} is configured in this environment.`
        : `${dest.technology} not detected — will fall back to a Cribl Search/Lake proof path.`,
      forcesFallback: !present,
    });
  }

  checks.push({
    id: 'pf-assets',
    label: 'Demo assets present',
    status: 'ok',
    detail: 'Pipelines, routes, and dashboard assets can be provisioned.',
  });

  const readiness = anyMissing ? 'fallback' : 'full';
  return {
    checkedAt: new Date().toISOString(),
    readiness,
    canDeploy: capabilities.products.includes('stream'),
    checks,
    fallbackNote: anyMissing
      ? 'One or more preferred destinations are unavailable. The routing story is preserved inside Cribl using Search/Lake as the proof path.'
      : undefined,
  };
}
