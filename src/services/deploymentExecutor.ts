import type {
  DeploymentActionResult,
  DeploymentPlan,
  DeploymentResult,
} from '../domain/types';
import {
  accelerateDataset,
  addDatasetRoute,
  commitAndDeploy,
  createOrReuseLakeDataset,
  ensureLakeDirectAccessSource,
  installPack,
  postNdjsonToLake,
  resolveDatasetIngestUrl,
  putKvValue,
  resolveAvailableDatasetId,
  resolveLakeId,
  resolveSearchIngestHost,
  tagFederatedSearchDataset,
  upsertDashboard,
  upsertInput,
  upsertLocalSearchSource,
  upsertOutput,
  upsertPipeline,
  upsertSavedSearch,
  upsertSearchDataset,
} from './criblApi';
import { generateSecurityFeed, type SecurityFeed } from '../domain/samples/security';

/** NDJSON lines per POST to the Lake Direct Access ingest endpoint. */
const INGEST_BATCH_SIZE = 800;

/**
 * Deployment executor. Runs each action against the Cribl REST API:
 *  - create-input / create-output / create-pipeline upsert config into the
 *    target worker group (idempotent, so redeploys are safe)
 *  - create-lake-dataset / create-saved-search / create-dashboard set up the
 *    federated Cribl Search tier
 *  - commit-deploy pushes the group config to Workers
 *
 * commit-deploy and the Search-tier artifacts are treated as non-fatal: the
 * core stream path (source → destinations) is what makes the demo work, so a
 * hiccup wiring up Search or committing is reported as a warning, not a failure.
 */

/**
 * Op types whose failure should NOT fail the whole deployment. The Lake dataset
 * is NOT soft: the Lake destination's `destPath` references it, so a dataset
 * failure must surface directly rather than as a confusing downstream
 * "not a valid dataset" error on the output.
 */
const SOFT_OP_TYPES = new Set([
  'commit-deploy',
  'create-saved-search',
  'create-dashboard',
  'accelerate-dataset',
  'create-search-source',
  'route-dataset',
  'put-ingest-token',
  'tag-federated-dataset',
]);

export interface ExecuteOptions {
  onActionComplete?: (result: DeploymentActionResult) => void;
}

async function runAction(
  plan: DeploymentPlan,
  action: DeploymentPlan['actions'][number],
): Promise<DeploymentActionResult> {
  const base = { actionId: action.id, label: action.label };
  try {
    switch (action.op?.type) {
      case 'create-input':
        await upsertInput(plan.groupId, action.op.objectId, action.op.config);
        return { ...base, status: 'succeeded' };
      case 'create-output':
        await upsertOutput(plan.groupId, action.op.objectId, action.op.config);
        return { ...base, status: 'succeeded' };
      case 'create-pipeline':
        await upsertPipeline(plan.groupId, action.op.objectId, action.op.conf);
        return { ...base, status: 'succeeded' };
      case 'install-pack':
        await installPack(plan.groupId, action.op.objectId, action.op.source);
        return { ...base, status: 'succeeded' };
      case 'create-lake-dataset': {
        const lakeId = await resolveLakeId(action.op.lakeId);
        const oldId = action.op.objectId;
        // Resilient create: if the fixed id is stuck (pending async deletion from
        // a prior reset), this returns the next free id. Remap the rest of the
        // plan (backfill/tag ops, Lake destPath, saved-search/dashboard queries)
        // so every downstream reference points at the id that was actually made.
        const newId = await createOrReuseLakeDataset(lakeId, oldId, action.op.config);
        if (newId !== oldId) {
          remapDatasetId(plan, oldId, newId);
          return {
            ...base,
            status: 'succeeded',
            message: `Created ${newId} ("${oldId}" was pending deletion from a prior run).`,
          };
        }
        return { ...base, status: 'succeeded' };
      }
      case 'accelerate-dataset': {
        const lakeId = await resolveLakeId(action.op.lakeId);
        await accelerateDataset(lakeId, action.op.objectId, action.op.engineId, action.op.config);
        return { ...base, status: 'succeeded' };
      }
      case 'create-lakehouse-dataset':
        await upsertSearchDataset(action.op.objectId, {
          ...action.op.config,
          engine: action.op.engineId,
        });
        return { ...base, status: 'succeeded' };
      case 'create-search-source':
        await upsertLocalSearchSource(action.op.objectId, action.op.config);
        return { ...base, status: 'succeeded' };
      case 'route-dataset':
        await addDatasetRoute(
          action.op.engineId,
          action.op.datasetId,
          action.op.sourceId,
        );
        return { ...base, status: 'succeeded' };
      case 'create-search-output': {
        const host = resolveSearchIngestHost();
        if (!host) {
          throw new Error(
            'Could not resolve the Cribl Search ingest host from CRIBL_API_URL.',
          );
        }
        // Strip the planner-only port marker; build the ingest url from it.
        const { __searchPort: _p, ...clean } = action.op.config as Record<
          string,
          unknown
        > & { __searchPort?: unknown };
        void _p;
        await upsertOutput(plan.groupId, action.op.objectId, {
          ...clean,
          url: `http://${host}:${action.op.port}`,
        });
        return { ...base, status: 'succeeded' };
      }
      case 'put-ingest-token':
        await putKvValue(action.op.key, action.op.token);
        return { ...base, status: 'succeeded' };
      case 'ensure-direct-access': {
        const lakeId = await resolveLakeId(action.op.lakeId);
        await ensureLakeDirectAccessSource(lakeId, action.op.sourceId, action.op.token);
        return { ...base, status: 'succeeded' };
      }
      case 'backfill-dataset': {
        const lakeId = await resolveLakeId(action.op.lakeId);
        // Poll for the ingest URL — Direct Access can report ready before its URL
        // is provisioned, and the first backfill may arrive during that window.
        const url = await resolveDatasetIngestUrl(lakeId, action.op.sourceId, action.op.objectId);
        const lines = generateSecurityFeed(
          action.op.seed,
          action.op.windowHours,
          action.op.anchorSec,
          action.op.feed as SecurityFeed,
        );
        let posted = 0;
        for (let i = 0; i < lines.length; i += INGEST_BATCH_SIZE) {
          posted += await postNdjsonToLake(url, lines.slice(i, i + INGEST_BATCH_SIZE));
        }
        return {
          ...base,
          status: 'succeeded',
          message: `${posted.toLocaleString()} backdated events ingested into ${action.op.objectId}.`,
        };
      }
      case 'tag-federated-dataset':
        await tagFederatedSearchDataset(action.op.objectId, {
          description: action.op.description,
          tags: action.op.tags,
        });
        return { ...base, status: 'succeeded' };
      case 'create-saved-search':
        await upsertSavedSearch(action.op.objectId, action.op.config);
        return { ...base, status: 'succeeded' };
      case 'create-dashboard':
        await upsertDashboard(action.op.objectId, action.op.config);
        return { ...base, status: 'succeeded' };
      case 'commit-deploy':
        await commitAndDeploy(plan.groupId);
        return { ...base, status: 'succeeded' };
      default:
        return { ...base, status: 'succeeded' };
    }
  } catch (err) {
    return {
      ...base,
      status: 'failed',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Swap `dataset="oldId"` → `dataset="newId"` inside an inline search query. */
function remapQuery(query: unknown, oldId: string, newId: string): unknown {
  if (typeof query !== 'string') return query;
  return query.split(`dataset="${oldId}"`).join(`dataset="${newId}"`);
}

/** Point a config's dataset references (Lake destPath + inline queries) at newId. */
function remapConfig(
  config: Record<string, unknown>,
  oldId: string,
  newId: string,
): void {
  if (config.destPath === oldId) config.destPath = newId;
  if (typeof config.query === 'string') config.query = remapQuery(config.query, oldId, newId);
  const elements = config.elements as Array<{ search?: { query?: unknown } }> | undefined;
  if (Array.isArray(elements)) {
    for (const el of elements) {
      if (el?.search) el.search.query = remapQuery(el.search.query, oldId, newId);
    }
  }
}

/**
 * Rewrite every reference to the Lake dataset id across the plan (the dataset
 * object, the Lake output's destPath, and the saved search + dashboard queries)
 * so they all agree on `newId`. Mutates the plan in place.
 */
function remapDatasetId(plan: DeploymentPlan, oldId: string, newId: string): void {
  for (const obj of plan.criblObjects) {
    if (obj.kind === 'lake-dataset' && obj.id === oldId) {
      obj.id = newId;
      obj.label = `Cribl Search dataset (${newId})`;
    }
    remapConfig(obj.config, oldId, newId);
  }
  for (const action of plan.actions) {
    const op = action.op;
    if (op?.type === 'create-lake-dataset' && op.objectId === oldId) {
      op.objectId = newId;
      action.label = `Create Cribl Search dataset — ${newId}`;
      action.detail = `Cribl Lake dataset ${newId}, searchable in Cribl Search.`;
    }
    if (op?.type === 'accelerate-dataset' && op.objectId === oldId) {
      op.objectId = newId;
    }
    // Historical-backfill ops reference the dataset by objectId too.
    if (op?.type === 'backfill-dataset' && op.objectId === oldId) {
      op.objectId = newId;
      action.detail = `Backfill ${op.feed} events into ${newId}.`;
    }
    if (op?.type === 'tag-federated-dataset' && op.objectId === oldId) {
      op.objectId = newId;
    }
    if (op && 'config' in op && op.config) {
      remapConfig(op.config as Record<string, unknown>, oldId, newId);
    }
  }
}

/**
 * If the plan's Lake dataset id is pending deletion (e.g. after a recent reset),
 * pick an available id and remap the plan so the Lake feed + Search assets use
 * it. No-op when the preferred id is usable.
 */
async function ensureAvailableDatasetId(plan: DeploymentPlan): Promise<void> {
  // Handle every Lake dataset the plan creates (the standard path has one; the
  // historical-backfill security path has several), so a redeploy shortly after a
  // reset — while old datasets are still pending async deletion — never collides.
  const datasetOps = plan.actions
    .map((a) => a.op)
    .filter((op): op is Extract<NonNullable<typeof op>, { type: 'create-lake-dataset' }> =>
      op?.type === 'create-lake-dataset',
    );
  for (const op of datasetOps) {
    const oldId = op.objectId;
    const lakeId = await resolveLakeId(op.lakeId);
    const newId = await resolveAvailableDatasetId(lakeId, oldId);
    if (newId !== oldId) remapDatasetId(plan, oldId, newId);
  }
}

export async function executeDeploymentPlan(
  plan: DeploymentPlan,
  options: ExecuteOptions = {},
): Promise<DeploymentResult> {
  const { onActionComplete } = options;
  const startedAt = new Date().toISOString();
  const actionResults: DeploymentActionResult[] = [];

  // Resolve a usable Lake dataset id up front (a recent reset may have left the
  // preferred id pending deletion) and remap all references before we execute.
  await ensureAvailableDatasetId(plan);

  for (const action of plan.actions) {
    const result = await runAction(plan, action);
    actionResults.push(result);
    onActionComplete?.(result);
  }

  // Core stream-object creation failures are hard failures; commit/deploy and
  // the Search-tier artifacts are soft warnings (the demo still works).
  const createFailures = actionResults.filter(
    (r, i) => r.status === 'failed' && !SOFT_OP_TYPES.has(plan.actions[i]?.op?.type ?? ''),
  );
  const softFailures = actionResults.filter(
    (r, i) => r.status === 'failed' && SOFT_OP_TYPES.has(plan.actions[i]?.op?.type ?? ''),
  );
  const deployFailed = actionResults.some(
    (r, i) => r.status === 'failed' && plan.actions[i]?.op?.type === 'commit-deploy',
  );

  const status = createFailures.length > 0 ? 'failed' : 'succeeded';
  const isBackfill = plan.actions.some((a) => a.op?.type === 'backfill-dataset');

  let message: string;
  if (createFailures.length > 0) {
    message = `${createFailures.length} object(s) failed to deploy. ${createFailures[0].message ?? ''}`.trim();
  } else if (deployFailed) {
    message =
      'Objects created in Cribl, but commit/deploy did not complete. Deploy the group manually to start data flow.';
  } else if (softFailures.length > 0) {
    const detail = softFailures
      .map((f) => `${f.label}: ${f.message ?? 'failed'}`)
      .join(' · ');
    message = isBackfill
      ? `Backfill complete and datasets are federated-searchable. ${softFailures.length} follow-up(s) need attention — ${detail}`
      : `Demo deployed and flowing via QuickConnect. ${softFailures.length} Search artifact(s) need attention — ${detail}`;
  } else if (isBackfill) {
    message =
      'Backfill complete. Backdated events are in Cribl Lake and federated-searchable — allow ~1 min, then run the AI Investigator with the seed alert.';
  } else {
    message =
      'Demo deployed. Source is live, events flow via QuickConnect, and the federated Search dataset + dashboard are ready.';
  }

  // Stamp the running build so pasted deploy results always identify the version
  // (avoids ambiguity when a stale app bundle is cached in Cribl).
  message = `${message} [build ${__APP_VERSION__}]`;

  return {
    planId: plan.id,
    status,
    startedAt,
    finishedAt: new Date().toISOString(),
    actionResults,
    message,
  };
}
