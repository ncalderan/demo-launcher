import type {
  CriblObjectSpec,
  DeploymentAction,
  DeploymentPlan,
  ResetResult,
} from '../domain/types';
import { SECURITY_DATASET_IDS } from '../domain/samples/security';
import {
  commitAndDeploy,
  removeDatasetRoute,
  deleteDashboard,
  deleteInput,
  deleteKvValue,
  deleteLakeDataset,
  deleteLocalSearchSource,
  deleteOutput,
  deletePipeline,
  deleteSavedSearch,
  deleteSearchDataset,
  listDashboardIds,
  listInputIds,
  listLakeDatasetIds,
  listLocalSearchSourceIds,
  listOutputIds,
  listPipelineIds,
  listSavedSearchIds,
  pruneLakeDirectAccessTokens,
  resolveLakeId,
  unlinkDatasetFromEngine,
  LAKE_DIRECT_ACCESS_ID,
  LAKE_INGEST_TOKEN_KV_KEY,
} from './criblApi';

/**
 * Every Cribl object this app creates in a worker group is id-prefixed with
 * `demo_` (sources, destinations, loop, datagen, replay + processing pipelines).
 * Cleanup keys off this prefix so we catch orphans from earlier deploys too —
 * e.g. after redeploying a different scenario (new token), or reloading the app
 * so the in-memory plan no longer matches what's actually deployed.
 */
const DEMO_ID_PREFIX = 'demo_';

/** A live count of this app's assets deployed in a worker group. */
export interface DemoFootprint {
  groupId: string;
  /** Number of distinct `demo_`-prefixed group objects (source/dest/pipeline). */
  assetCount: number;
  /** True when at least one demo asset is present. */
  deployed: boolean;
}

/**
 * Detect whether a demo is currently deployed in a worker group, without needing
 * the in-memory plan. Sweeps the group's inputs/outputs/pipelines for
 * `demo_`-prefixed ids — every demo creates these, so they're a reliable signal.
 * Best-effort: listing failures are treated as "nothing found".
 */
export async function detectDeployedDemo(groupId: string): Promise<DemoFootprint> {
  const ids = new Set<string>();
  const sweep = async (list: (g: string) => Promise<string[]>) => {
    try {
      for (const id of await list(groupId)) {
        if (id.startsWith(DEMO_ID_PREFIX)) ids.add(id);
      }
    } catch {
      /* ignore — treat as nothing found */
    }
  };
  await sweep(listInputIds);
  await sweep(listOutputIds);
  await sweep(listPipelineIds);
  return { groupId, assetCount: ids.size, deployed: ids.size > 0 };
}

interface TearDownOptions {
  planId: string;
  groupId: string;
  /** Optional plan objects to union with the live sweep (belt-and-suspenders). */
  seedObjects?: CriblObjectSpec[];
  /** Optional plan actions, used to unlink accelerated datasets. */
  planActions?: DeploymentAction[];
}

/**
 * Core teardown. Deletes this app's Cribl objects and commits + deploys so the
 * worker group reflects the removal.
 *
 * Works with OR without an in-memory plan: it always does a live sweep of the
 * group (and the global Lake/Search tiers) for `demo_`-prefixed objects, so a
 * demo can be torn down even after navigating away or reloading. When a plan is
 * provided, its objects/actions are unioned in for completeness. Inputs are
 * deleted FIRST so their QuickConnect connections release the outputs/pipelines
 * they reference. Idempotent: missing objects (404) are treated as already gone.
 */
async function tearDownGroup(opts: TearDownOptions): Promise<ResetResult> {
  const { planId, groupId: group, seedObjects, planActions } = opts;
  const removedActionIds: string[] = [];
  let lastError: string | undefined;

  const inputIds = new Set<string>();
  const outputIds = new Set<string>();
  const pipelineIds = new Set<string>();
  const lakeDatasetIds = new Set<string>();
  const searchDatasetIds = new Set<string>();
  const savedSearchIds = new Set<string>();
  const dashboardIds = new Set<string>();

  // 1) Everything the current plan created, if a plan was supplied (Packs are
  //    intentionally left in place).
  for (const obj of seedObjects ?? []) {
    switch (obj.kind) {
      case 'input':
        inputIds.add(obj.id);
        break;
      case 'output':
        outputIds.add(obj.id);
        break;
      case 'pipeline':
        pipelineIds.add(obj.id);
        break;
      case 'lake-dataset':
        // Lakehouse (search-engine) datasets carry an `engine` and are removed via
        // the Search datasets endpoint; federated Lake datasets via the Lake API.
        if (obj.config.engine) searchDatasetIds.add(obj.id);
        else lakeDatasetIds.add(obj.id);
        break;
      case 'saved-search':
        savedSearchIds.add(obj.id);
        break;
      case 'dashboard':
        dashboardIds.add(obj.id);
        break;
      case 'pack':
        break;
    }
  }

  // 2) Live sweep of the worker group for any lingering demo-prefixed objects.
  //    Best-effort: a failed listing shouldn't abort the teardown.
  const sweep = async (list: (g: string) => Promise<string[]>, into: Set<string>) => {
    try {
      for (const id of await list(group)) {
        if (id.startsWith(DEMO_ID_PREFIX)) into.add(id);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/not found|404/i.test(msg)) lastError = msg;
    }
  };
  await sweep(listInputIds, inputIds);
  await sweep(listOutputIds, outputIds);
  await sweep(listPipelineIds, pipelineIds);

  // Lake datasets and Search artifacts live outside the worker group, and their
  // ids can drift from the in-memory plan (e.g. the executor appends `_1`/`_2`
  // when a preferred dataset id is still pending deletion). Sweep them by prefix
  // too so those orphans are cleaned up, not just the plan's original ids.
  const lakeId = await resolveLakeId();
  const sweepGlobal = async (list: () => Promise<string[]>, into: Set<string>) => {
    try {
      for (const id of await list()) {
        if (id.startsWith(DEMO_ID_PREFIX)) into.add(id);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/not found|404/i.test(msg)) lastError = msg;
    }
  };
  const searchSourceIds = new Set<string>();
  await sweepGlobal(() => listLakeDatasetIds(lakeId), lakeDatasetIds);
  // The AI Investigator security demo uses fixed, authentic (non-`demo_`) Lake
  // dataset ids, so they won't match the prefix sweep. Resilient create can also
  // land on a `_N`-suffixed variant when the base id was pending deletion, so
  // match both the base ids and their suffixes, plus add the base ids directly
  // (a pending-deletion copy is hidden from the list but still needs deleting).
  try {
    for (const id of await listLakeDatasetIds(lakeId)) {
      if (SECURITY_DATASET_IDS.some((baseId) => id === baseId || id.startsWith(`${baseId}_`))) {
        lakeDatasetIds.add(id);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/not found|404/i.test(msg)) lastError = msg;
  }
  for (const id of SECURITY_DATASET_IDS) lakeDatasetIds.add(id);
  await sweepGlobal(listSavedSearchIds, savedSearchIds);
  await sweepGlobal(listDashboardIds, dashboardIds);
  await sweepGlobal(listLocalSearchSourceIds, searchSourceIds);

  const del = async (id: string, fn: () => Promise<void>) => {
    try {
      await fn();
      removedActionIds.push(id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // "not found" → already gone. "marked for deletion" → a Lake dataset whose
      // async teardown is already underway. Both mean there's nothing left to do.
      if (!/not found|404|marked for deletion/i.test(msg)) lastError = msg;
      else removedActionIds.push(id);
    }
  };

  // 3) Delete in dependency-safe order: inputs first (this removes the
  //    QuickConnect connections that reference outputs/pipelines), then outputs,
  //    then pipelines, then the Search-tier artifacts.
  for (const id of inputIds) await del(id, () => deleteInput(group, id));
  for (const id of outputIds) await del(id, () => deleteOutput(group, id));
  for (const id of pipelineIds) await del(id, () => deletePipeline(group, id));
  // Unlink any datasets we accelerated onto a Search engine before deleting them,
  // so the engine isn't left pointing at a deleted dataset. Best-effort.
  for (const action of planActions ?? []) {
    const op = action.op;
    if (op?.type === 'accelerate-dataset') {
      try {
        await unlinkDatasetFromEngine(op.engineId, op.objectId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!/not found|404/i.test(msg)) lastError = msg;
      }
    }
  }
  for (const id of lakeDatasetIds) await del(id, () => deleteLakeDataset(lakeId, id));
  // Remove the Lakehouse engine routing rule that points at each Search dataset
  // before deleting the dataset, so the engine isn't left with a dangling rule.
  for (const id of searchDatasetIds) {
    try {
      await removeDatasetRoute(id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/not found|404/i.test(msg)) lastError = msg;
    }
  }
  for (const id of searchDatasetIds) await del(id, () => deleteSearchDataset(id));
  for (const id of searchSourceIds) await del(id, () => deleteLocalSearchSource(id));
  for (const id of savedSearchIds) await del(id, () => deleteSavedSearch(id));
  for (const id of dashboardIds) await del(id, () => deleteDashboard(id));

  // Historical-backfill (AI Investigator) teardown: remove this app's ingest
  // tokens from the shared Lake Direct Access HTTP Source (never delete the
  // source itself) and drop the KV ingest token. Best-effort — a demo without
  // backfill assets simply has nothing to clean here.
  try {
    await pruneLakeDirectAccessTokens(lakeId, LAKE_DIRECT_ACCESS_ID);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/not found|404/i.test(msg)) lastError = msg;
  }
  try {
    await deleteKvValue(LAKE_INGEST_TOKEN_KV_KEY);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/not found|404/i.test(msg)) lastError = msg;
  }

  try {
    await commitAndDeploy(group);
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
  }

  return {
    planId,
    resetAt: new Date().toISOString(),
    status: lastError ? 'failed' : 'succeeded',
    removedActionIds,
    message: lastError
      ? `Teardown completed with warnings: ${lastError}`
      : 'Demo torn down. Ready to redeploy or run a different scenario.',
  };
}

/**
 * Reset / cleanup for the current in-memory plan (used from the deploy flow).
 */
export async function resetDeployment(plan: DeploymentPlan): Promise<ResetResult> {
  return tearDownGroup({
    planId: plan.id,
    groupId: plan.groupId,
    seedObjects: plan.criblObjects,
    planActions: plan.actions,
  });
}

/**
 * Reset / cleanup driven purely by a live sweep of a worker group — no plan
 * required. Lets an SE tear a demo down after navigating away from the deploy
 * page or reloading the app.
 */
export async function resetDeployedAssets(groupId: string): Promise<ResetResult> {
  return tearDownGroup({ planId: 'live-sweep', groupId });
}
