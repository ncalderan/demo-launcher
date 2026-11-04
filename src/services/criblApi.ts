import type { WorkerGroupRef } from '../domain/types';

/**
 * Thin Cribl REST client. All calls go to `CRIBL_API_URL`; the platform fetch
 * proxy injects auth and scopes the request to this app (see AGENTS.md).
 *
 * Worker-group config lives under `/m/{groupId}/...`. Search endpoints (not used
 * here) must always use groupId `default_search`.
 *
 * NOTE: the proxy only works when the app is installed in Cribl. Under
 * `npm run dev` these calls will not reach the Leader — the executor handles
 * that gracefully and reports the failure per action.
 */

function apiBase(): string {
  const url = (window as unknown as { CRIBL_API_URL?: string }).CRIBL_API_URL;
  if (!url) {
    throw new Error(
      'CRIBL_API_URL is not available. Install the app in Cribl to deploy (dev preview cannot reach the Leader).',
    );
  }
  return url.replace(/\/$/, '');
}

function groupBase(groupId: string): string {
  return `${apiBase()}/m/${encodeURIComponent(groupId)}`;
}

async function request<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? (JSON.parse(text) as unknown) : undefined;
  } catch {
    // Non-JSON body (e.g. an HTML error page from the proxy). Surface the raw
    // text so failures are diagnosable instead of throwing an opaque parse error.
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 200)}`.trim());
    }
    return undefined as T;
  }
  if (!res.ok) {
    const apiMsg = (data as { message?: string })?.message;
    const message = apiMsg
      ? `${res.status} ${res.statusText}: ${apiMsg}`
      : `${res.status} ${res.statusText}`;
    throw new Error(message);
  }
  return data as T;
}

/** List Stream worker groups (config groups). */
export async function listWorkerGroups(): Promise<WorkerGroupRef[]> {
  const data = await request<{ items?: Array<Record<string, unknown>> }>(
    'GET',
    `${apiBase()}/master/groups`,
  );
  return (data.items ?? [])
    .filter((g) => g.type === 'stream')
    .map((g) => ({
      id: String(g.id),
      name: String(g.name ?? g.id),
      description: g.description ? String(g.description) : undefined,
    }));
}

/**
 * Upsert an input: POST to create, and if it already exists, PATCH by id.
 * Makes redeploys idempotent.
 */
export async function upsertInput(
  groupId: string,
  id: string,
  config: Record<string, unknown>,
): Promise<void> {
  const base = `${groupBase(groupId)}/system/inputs`;
  const payload = { ...config, id };
  try {
    await request('POST', base, payload);
  } catch {
    await request('PATCH', `${base}/${encodeURIComponent(id)}`, payload);
  }
}

/** Upsert an output: POST to create, PATCH by id if it exists. */
export async function upsertOutput(
  groupId: string,
  id: string,
  config: Record<string, unknown>,
): Promise<void> {
  const base = `${groupBase(groupId)}/system/outputs`;
  const payload = { ...config, id };
  try {
    await request('POST', base, payload);
  } catch {
    await request('PATCH', `${base}/${encodeURIComponent(id)}`, payload);
  }
}

/** Upsert a pipeline: POST to create, PATCH by id if it exists. */
export async function upsertPipeline(
  groupId: string,
  id: string,
  conf: Record<string, unknown>,
): Promise<void> {
  const base = `${groupBase(groupId)}/pipelines`;
  const payload = { id, conf };
  try {
    await request('POST', base, payload);
  } catch {
    await request('PATCH', `${base}/${encodeURIComponent(id)}`, payload);
  }
}

export async function deletePipeline(groupId: string, id: string): Promise<void> {
  await request('DELETE', `${groupBase(groupId)}/pipelines/${encodeURIComponent(id)}`);
}

/**
 * Install a Cribl Pack into a worker group from a Dispensary/URL/git `source`.
 * The Cribl Leader downloads the `.crbl` server-side, so the app itself needs no
 * outbound access. Idempotent: if the pack `id` is already installed, that's fine.
 */
export async function installPack(
  groupId: string,
  id: string,
  source: string,
): Promise<void> {
  const base = `${groupBase(groupId)}/packs`;
  try {
    await request('POST', base, { source, force: true, allowCustomFunctions: true });
  } catch (err) {
    // Already installed? Treat as success so redeploys stay idempotent.
    try {
      await request('GET', `${base}/${encodeURIComponent(id)}`);
    } catch {
      throw err;
    }
  }
}

export async function deleteInput(groupId: string, id: string): Promise<void> {
  await request('DELETE', `${groupBase(groupId)}/system/inputs/${encodeURIComponent(id)}`);
}

export async function deleteOutput(groupId: string, id: string): Promise<void> {
  await request('DELETE', `${groupBase(groupId)}/system/outputs/${encodeURIComponent(id)}`);
}

/** Return the ids of every object in a collection endpoint. */
async function listIds(path: string): Promise<string[]> {
  const data = await request<{ items?: Array<{ id?: unknown }> }>('GET', path);
  return (data.items ?? [])
    .map((i) => (i.id == null ? '' : String(i.id)))
    .filter((id) => id.length > 0);
}

/** Full item configs (not just ids) at a collection endpoint. */
async function listItems(path: string): Promise<Array<Record<string, unknown>>> {
  const data = await request<{ items?: Array<Record<string, unknown>> }>('GET', path);
  return data.items ?? [];
}

/** List all input ids in a worker group (used for tag/prefix-based cleanup). */
export async function listInputIds(groupId: string): Promise<string[]> {
  return listIds(`${groupBase(groupId)}/system/inputs`);
}

/** Full input configs (type, port, …) at the GROUP level (not inside a pack). */
export async function listGroupInputConfigs(
  groupId: string,
): Promise<Array<Record<string, unknown>>> {
  return listItems(`${groupBase(groupId)}/system/inputs`);
}

/** List all pack ids installed in a worker group. */
export async function listPackIds(groupId: string): Promise<string[]> {
  return listIds(`${groupBase(groupId)}/packs`);
}

/** Full input configs (type, port, …) scoped inside one pack in a group. */
export async function listPackInputConfigs(
  groupId: string,
  packId: string,
): Promise<Array<Record<string, unknown>>> {
  return listItems(`${groupBase(groupId)}/p/${encodeURIComponent(packId)}/system/inputs`);
}

/** List all output ids in a worker group. */
export async function listOutputIds(groupId: string): Promise<string[]> {
  return listIds(`${groupBase(groupId)}/system/outputs`);
}

/** List all pipeline ids in a worker group. */
export async function listPipelineIds(groupId: string): Promise<string[]> {
  return listIds(`${groupBase(groupId)}/pipelines`);
}

/** List all Cribl Lake dataset ids under a Lake (used for prefix-based cleanup). */
export async function listLakeDatasetIds(lakeId: string): Promise<string[]> {
  return listIds(
    `${apiBase()}/products/lake/lakes/${encodeURIComponent(lakeId)}/datasets`,
  );
}

/** List ids from the first Search base that answers (saved searches / dashboards). */
async function listSearchIds(kind: string): Promise<string[]> {
  let lastErr: unknown;
  for (const base of searchBases(kind)) {
    try {
      return await listIds(base);
    } catch (err) {
      lastErr = err;
    }
  }
  if (lastErr && !/not found|404/i.test(String(lastErr))) throw lastErr;
  return [];
}

/** List all saved-search ids in the Search group. */
export async function listSavedSearchIds(): Promise<string[]> {
  return listSearchIds('saved');
}

/** List all dashboard ids in the Search group. */
export async function listDashboardIds(): Promise<string[]> {
  return listSearchIds('dashboards');
}

/* ------------------------------- Cribl Search ----------------------------- */

/** Search objects live in the search group; Lake datasets under the default Lake. */
const SEARCH_GROUP = 'default_search';

/**
 * Candidate base paths for a Search object endpoint. Inside a Cribl app the
 * fetch proxy requires `/search/*` calls to be group-scoped through the search
 * group (`/m/default_search/search/...`) — see AGENTS.md. We try that first and
 * fall back to the org-global path (`/search/...`) for non-proxied contexts.
 */
function searchBases(kind: string): string[] {
  return [
    `${apiBase()}/m/${SEARCH_GROUP}/search/${kind}`,
    `${apiBase()}/search/${kind}`,
  ];
}

/**
 * Upsert against the first candidate base that accepts it. For each base we POST
 * to create; if that fails, we GET by id to see whether it already exists and,
 * only then, PATCH it. We surface the real CREATE error from the primary base
 * (not a misleading PATCH "not found") so failures are diagnosable.
 */
async function upsertMulti(
  bases: string[],
  id: string,
  payload: Record<string, unknown>,
): Promise<void> {
  let primaryErr: unknown;
  for (const base of bases) {
    try {
      await request('POST', base, payload);
      return;
    } catch (postErr) {
      if (primaryErr === undefined) primaryErr = postErr;
      // Does it already exist here? If so, update it in place.
      let exists = false;
      try {
        await request('GET', `${base}/${encodeURIComponent(id)}`);
        exists = true;
      } catch {
        exists = false;
      }
      if (exists) {
        try {
          await request('PATCH', `${base}/${encodeURIComponent(id)}`, payload);
          return;
        } catch (patchErr) {
          if (primaryErr === undefined) primaryErr = patchErr;
        }
      }
    }
  }
  throw primaryErr instanceof Error ? primaryErr : new Error(String(primaryErr));
}

/** Delete against whichever candidate base has the object. */
async function deleteMulti(bases: string[], id: string): Promise<void> {
  let lastErr: unknown;
  for (const base of bases) {
    try {
      await request('DELETE', `${base}/${encodeURIComponent(id)}`);
      return;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * Resolve the id of the Cribl Lake to create datasets under. Cribl.Cloud has a
 * single Lake (id `default`); we look it up so we don't hard-code the wrong id,
 * and fall back to the caller's preferred id if the list endpoint isn't there.
 */
export async function resolveLakeId(preferred = 'default'): Promise<string> {
  try {
    const data = await request<{ items?: Array<{ id?: string }> }>(
      'GET',
      `${apiBase()}/products/lake/lakes`,
    );
    const id = data.items?.[0]?.id;
    return id ? String(id) : preferred;
  } catch {
    return preferred;
  }
}

/**
 * Pick a usable Cribl Lake dataset id. Deleting a Lake dataset only *marks* it
 * for deletion (async), and a dataset in that state cannot be recreated/updated
 * ("marked for deletion and cannot be updated"). So if `baseId` is pending
 * deletion we fall back to `baseId_1`, `baseId_2`, … until we find one that is
 * either absent or healthy (reusable). Best-effort: if listing fails we return
 * `baseId` unchanged.
 */
/** Ids of Lake datasets currently mid-deletion (empty set if the list can't be read). */
async function fetchPendingDeletionDatasetIds(lakeId: string): Promise<Set<string>> {
  const pendingDeletion = new Set<string>();
  try {
    const data = await request<{
      items?: Array<{ id?: string; deletionStartedAt?: number }>;
    }>('GET', `${apiBase()}/products/lake/lakes/${encodeURIComponent(lakeId)}/datasets`);
    for (const d of data.items ?? []) {
      if (d.id && d.deletionStartedAt) pendingDeletion.add(String(d.id));
    }
  } catch {
    /* can't tell — caller treats as "nothing known to be pending" */
  }
  return pendingDeletion;
}

export async function resolveAvailableDatasetId(
  lakeId: string,
  baseId: string,
): Promise<string> {
  const pendingDeletion = await fetchPendingDeletionDatasetIds(lakeId);
  if (!pendingDeletion.has(baseId)) return baseId;
  for (let i = 1; i < 50; i += 1) {
    const candidate = `${baseId}_${i}`;
    if (!pendingDeletion.has(candidate)) return candidate;
  }
  return `${baseId}_${Date.now()}`;
}

/**
 * Upsert a Cribl Lake dataset (the searchable storage the demo writes to).
 * Created under the default Lake so Cribl Search can federate over it.
 */
export async function upsertLakeDataset(
  lakeId: string,
  id: string,
  config: Record<string, unknown>,
): Promise<void> {
  const base = `${apiBase()}/products/lake/lakes/${encodeURIComponent(lakeId)}/datasets`;
  // `engineId` is a planner-only hint (which Search engine to accelerate onto);
  // it is not a Lake dataset field, so keep it out of the create/update payload.
  const { engineId: _engineId, ...clean } = config as Record<string, unknown> & {
    engineId?: unknown;
  };
  void _engineId;
  const payload = { ...clean, id };
  try {
    await request('POST', base, payload);
  } catch {
    await request('PATCH', `${base}/${encodeURIComponent(id)}`, payload);
  }
}

/**
 * Create-or-reuse a Lake dataset, resiliently, returning the id that was actually
 * used. Fixed (non-`demo_`-suffixed) dataset ids can get stuck: deleting a Lake
 * dataset only *marks* it for async deletion, and while in that state the id can
 * neither be recreated (POST fails) nor updated (PATCH 404s "does not exist"),
 * and it is hidden from the list endpoint so we can't detect it up front.
 *
 * So we probe reactively: try `baseId`, and only if BOTH create and update fail
 * (i.e. the id is stuck) do we move to `baseId_1`, `baseId_2`, … until one is
 * either freshly created or reused (healthy-existing → PATCH). This keeps the
 * authentic name in the normal case and self-heals after a recent reset. The
 * caller must remap any downstream references to the returned id.
 */
export async function createOrReuseLakeDataset(
  lakeId: string,
  baseId: string,
  config: Record<string, unknown>,
): Promise<string> {
  const base = `${apiBase()}/products/lake/lakes/${encodeURIComponent(lakeId)}/datasets`;
  const { engineId: _engineId, ...clean } = config as Record<string, unknown> & {
    engineId?: unknown;
  };
  void _engineId;
  let firstCreateErr: unknown;
  for (let i = 0; i < 25; i += 1) {
    const id = i === 0 ? baseId : `${baseId}_${i}`;
    const payload = { ...clean, id };
    try {
      await request('POST', base, payload);
      return id;
    } catch (postErr) {
      if (i === 0) firstCreateErr = postErr;
      const msg = postErr instanceof Error ? postErr.message : String(postErr);
      const conflict = /409|conflict|already exists|already in use|duplicate/i.test(msg);
      const pendingDeletion = /pending deletion|marked for deletion|being deleted/i.test(msg);
      // Healthy-existing dataset: the id is taken but usable — update it in place.
      if (conflict && !pendingDeletion) {
        try {
          await request('PATCH', `${base}/${encodeURIComponent(id)}`, payload);
          return id;
        } catch {
          // Update failed too (likely pending deletion) — advance to the next id.
          continue;
        }
      }
      // Stuck id (pending async deletion from a prior reset) — try the next one.
      if (pendingDeletion) continue;
      // Any other failure is a REAL create error (validation, storage location,
      // permissions, quota, …). Do NOT mask it behind a suffix loop + PATCH 404 —
      // surface it immediately so the deploy screen shows the true cause.
      throw new Error(`Create Lake dataset "${id}" failed: ${msg}`);
    }
  }
  throw firstCreateErr instanceof Error
    ? new Error(`Create Lake dataset "${baseId}" failed after retries: ${firstCreateErr.message}`)
    : new Error(`Could not create Lake dataset "${baseId}" (all candidate ids exhausted).`);
}

interface LocalSearchEngine {
  id: string;
  engineType?: string;
  tierSize?: string;
  description?: string;
  datasets?: string[];
}

/** Response wrapper for the Local Search engine endpoints (`{ items: [...] }`). */
interface CountedLocalSearchEngine {
  count?: number;
  items?: LocalSearchEngine[];
}

/**
 * List the Local Search (Lakehouse) engines provisioned on this stack, so the
 * wizard can offer the org's ACTUAL engines instead of a hardcoded list. Returns
 * `[]` if the endpoint isn't reachable (e.g. non-cloud stacks) so callers can
 * fall back to their static defaults.
 */
export async function listSearchEngines(): Promise<
  Array<{ id: string; description?: string }>
> {
  let lastErr: unknown;
  for (const base of searchBases('local_search/engines')) {
    try {
      const data = await request<CountedLocalSearchEngine>('GET', base);
      return (data.items ?? [])
        .filter((e) => Boolean(e?.id))
        .map((e) => ({ id: e.id, description: e.description }));
    } catch (err) {
      lastErr = err;
    }
  }
  void lastErr;
  return [];
}

/**
 * Fetch a single Local Search engine by id, tolerating the two response shapes
 * the API/proxy can return: a wrapped `{ items: [engine] }` (the documented
 * `CountedLocalSearchEngine`) or a bare engine object. We first try GET-by-id on
 * each candidate base; if that route isn't reachable (some proxy contexts only
 * expose the collection), we fall back to listing all engines and matching the
 * id. Returns `{ base, engine }` for the base that worked so the caller can PATCH
 * the same base, or throws the last error if nothing resolved.
 */
async function fetchLocalEngine(
  engineId: string,
): Promise<{ base: string; engine: LocalSearchEngine }> {
  const collectionBases = searchBases('local_search/engines');
  let lastErr: unknown;

  const pick = (data: unknown): LocalSearchEngine | undefined => {
    const wrapped = data as CountedLocalSearchEngine | undefined;
    if (wrapped?.items && Array.isArray(wrapped.items)) {
      return (
        wrapped.items.find((e) => e?.id === engineId) ?? wrapped.items[0]
      );
    }
    const bare = data as LocalSearchEngine | undefined;
    return bare?.id ? bare : undefined;
  };

  for (const collection of collectionBases) {
    const byId = `${collection}/${encodeURIComponent(engineId)}`;
    // 1) Try GET by id.
    try {
      const engine = pick(await request('GET', byId));
      if (engine) return { base: byId, engine };
    } catch (err) {
      lastErr = err;
    }
    // 2) Fall back to listing the collection and matching by id.
    try {
      const list = await request<CountedLocalSearchEngine>('GET', collection);
      const engine = (list.items ?? []).find((e) => e?.id === engineId);
      if (engine) return { base: byId, engine };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(`Local Search engine '${engineId}' not found`);
}

/**
 * Link a Lake dataset to a Local Search (Lakehouse) engine so it becomes a
 * search-engine dataset (accelerated), not just a federated one — the API
 * equivalent of adding the dataset to the engine (e.g. quick_search) in the UI.
 * We resolve the engine, add our dataset id to its `datasets[]` (deduped), and
 * PATCH it back, preserving the engine's tier/type. Best-effort: the dataset is
 * still searchable even if this fails, so the caller treats it as a soft warning.
 *
 * `lakeId`/`config` are accepted for signature symmetry with the other dataset
 * ops but are not needed to link an engine.
 */
export async function accelerateDataset(
  _lakeId: string,
  id: string,
  engineId: string,
  _config: Record<string, unknown>,
): Promise<void> {
  void _lakeId;
  void _config;
  const { base, engine } = await fetchLocalEngine(engineId);
  const existing = Array.isArray(engine.datasets) ? engine.datasets : [];
  if (existing.includes(id)) return; // Already linked — idempotent.
  const payload: LocalSearchEngine = {
    id: engineId,
    engineType: engine.engineType ?? 'local',
    ...(engine.tierSize ? { tierSize: engine.tierSize } : {}),
    ...(engine.description ? { description: engine.description } : {}),
    datasets: [...existing, id],
  };
  await request('PATCH', base, payload);
}

/**
 * Remove a dataset from a Local Search engine's `datasets[]` (reverse of
 * accelerateDataset), so teardown doesn't leave the engine pointing at a deleted
 * dataset. Best-effort and idempotent: no-op if the dataset isn't linked or the
 * engine is gone.
 */
export async function unlinkDatasetFromEngine(
  engineId: string,
  datasetId: string,
): Promise<void> {
  let resolved: { base: string; engine: LocalSearchEngine };
  try {
    resolved = await fetchLocalEngine(engineId);
  } catch (err) {
    // Engine already gone (or unreachable) — nothing to unlink.
    if (/not found|404/i.test(String(err))) return;
    throw err instanceof Error ? err : new Error(String(err));
  }
  const { base, engine } = resolved;
  const existing = Array.isArray(engine.datasets) ? engine.datasets : [];
  if (!existing.includes(datasetId)) return; // Not linked — nothing to do.
  const payload: LocalSearchEngine = {
    id: engineId,
    engineType: engine.engineType ?? 'local',
    ...(engine.tierSize ? { tierSize: engine.tierSize } : {}),
    ...(engine.description ? { description: engine.description } : {}),
    datasets: existing.filter((d) => d !== datasetId),
  };
  await request('PATCH', base, payload);
}

export async function deleteLakeDataset(lakeId: string, id: string): Promise<void> {
  await request(
    'DELETE',
    `${apiBase()}/products/lake/lakes/${encodeURIComponent(lakeId)}/datasets/${encodeURIComponent(id)}`,
  );
}

/* ------------- Cribl Lake — Direct Access (HTTP) NDJSON ingest -------------- */

/**
 * Fixed app-scoped KV key that holds the Direct Access ingest token. The token
 * VALUE is generated fresh per deploy and stored here; `config/proxies.yml`
 * references it as `kv.demoLakeIngestToken` and injects it as the `Authorization`
 * header on outbound ingest requests. This is required because the platform
 * fetch proxy STRIPS any `Authorization` header the app sets itself (see
 * AGENTS.md) — so the token must be injected server-side from KV.
 */
export const LAKE_INGEST_TOKEN_KV_KEY = 'demoLakeIngestToken';

/**
 * Id of the Direct Access HTTP Source the security-backfill demo uses. Cribl.Cloud
 * allows one HTTP Direct Access Source per workspace, so we use the conventional
 * `default` id and create-or-merge into it (see ensureLakeDirectAccessSource).
 */
export const LAKE_DIRECT_ACCESS_ID = 'default';

/**
 * Store a value in this app's scoped KV store (used for the ingest token).
 *
 * Deliberately NOT using the generic `request()` helper: the KV store API is
 * the one Cribl endpoint that wants the raw string as the body with
 * `Content-Type: text/plain;charset=UTF-8` (confirmed in Cribl's own Builder
 * Guide), not a JSON-encoded body. Going through `request()` would send
 * `Content-Type: application/json` and `JSON.stringify(value)` — which
 * double-quotes the value and sends it as JSON instead of raw text, and gets
 * rejected with a 400. That 400 was silently swallowed for a long time
 * because this op used to be marked "soft" in the executor (see
 * `SOFT_OP_TYPES` in deploymentExecutor.ts) — every backfill POST downstream
 * then failed with a generic, misleading 401 "Access denied" instead.
 */
export async function putKvValue(key: string, value: string): Promise<void> {
  const res = await fetch(`${apiBase()}/kvstore/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: value,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `KV store PUT "${key}" failed: ${res.status} ${res.statusText}: ${text.slice(0, 200)}`.trim(),
    );
  }
}

/** Delete a value from this app's scoped KV store (best-effort cleanup). */
export async function deleteKvValue(key: string): Promise<void> {
  await request('DELETE', `${apiBase()}/kvstore/${encodeURIComponent(key)}`);
}

/** Marker on Direct Access tokens this app owns, so we can prune stale ones. */
const DA_TOKEN_MARKER = 'SE Demo Launcher NDJSON ingest';

interface DirectAccessIngestUrl {
  type: string;
  url: string;
}
interface DirectAccessItem {
  id: string;
  authTokens?: Array<{ token: string; description?: string }>;
  // The real API field behind the UI's "Direct Access Datasets" — the
  // allowlist of Lake dataset ids this source may ingest into. Confirmed via
  // Cribl's own internal Direct Access HTTP design doc (not in our bundled
  // openapi.json, which has no such field on this resource at all). Omitting
  // a dataset here makes ingest to it fail with a flat 401 "Access denied",
  // indistinguishable from an auth problem unless you check this field.
  datasetIds?: string[];
  ingestUrl?: string;
  ingestUrls?: DirectAccessIngestUrl[];
  // Real enum confirmed via openapi.json's CriblLakeLifecycleItemStatus.
  status?: 'provisioning' | 'ready' | 'failed' | 'terminated' | 'delayed' | 'blocked' | string;
}

const DIRECT_ACCESS_TERMINAL_FAILURE_STATUSES = new Set(['failed', 'terminated', 'blocked']);

function directAccessBase(lakeId: string): string {
  return `${apiBase()}/products/lake/lakes/${encodeURIComponent(lakeId)}/direct-access`;
}

/**
 * Fetch the (single) Direct Access HTTP Source for a Lake, if one exists.
 *
 * There is exactly ONE Direct Access resource per Lake, exposed at
 * `/direct-access` (NOT `/direct-access/{id}` — that route does not exist and
 * returns "Cannot <METHOD> …"). GET returns a single-item list.
 */
export async function getLakeDirectAccessSource(
  lakeId: string,
  id: string,
): Promise<DirectAccessItem | undefined> {
  try {
    const data = await request<{ items?: DirectAccessItem[] }>('GET', directAccessBase(lakeId));
    const items = data.items ?? [];
    return items.find((i) => i.id === id) ?? items[0];
  } catch {
    return undefined;
  }
}

/** Resolve after `ms` — small helper for provisioning polls. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Ensure a usable Direct Access HTTP Source on the Lake — DISCOVER FIRST, then
 * reuse; only provision a new one when none exists.
 *
 * Cribl.Cloud allows exactly ONE HTTP Direct Access Source per Lake (addressed
 * at `/direct-access`, no id in the path). Standing one up the first time takes
 * a few minutes (status "provisioning", no ingestUrls). To avoid re-paying that
 * cost every deploy, we:
 *   1. GET the existing source. If present, REUSE it — just register our own
 *      ingest token (PUT-merge, keeping tenant tokens, pruning our prior ones).
 *      An already-provisioned source returns its ingest URL immediately.
 *   2. Only if none exists do we POST-create (which kicks off provisioning).
 *   3. Poll for the ingest URL only while it's genuinely missing — a reused,
 *      already-provisioned source skips the wait entirely.
 */
export async function ensureLakeDirectAccessSource(
  lakeId: string,
  id: string,
  token: string,
  datasetIds: string[],
): Promise<DirectAccessItem> {
  const base = directAccessBase(lakeId);
  const authToken = { token, description: DA_TOKEN_MARKER };

  // 1) Discover an existing source and reuse it.
  let item = await getLakeDirectAccessSource(lakeId, id);
  if (item) {
    const hasOurToken = item.authTokens?.some((t) => t.token === token) ?? false;
    const missingDatasetIds = datasetIds.filter((d) => !(item?.datasetIds ?? []).includes(d));
    if (!hasOurToken || missingDatasetIds.length > 0) {
      // Register our token and dataset ids without disturbing tenant-configured
      // ones; prune our own stale tokens so the source doesn't accumulate one
      // per deploy. Dataset ids are additive, EXCEPT for ones that are
      // currently mid-deletion: Lake validates the WHOLE `datasetIds` array on
      // every update, so a single stale, pending-deletion id left over from an
      // earlier reset (e.g. an old `_2`-suffix collision rename) makes the
      // ENTIRE update 400 — including our brand-new, valid ids. Confirmed
      // live: "Dataset '...' is being deleted and cannot be used for Direct
      // Access."
      const pendingDeletion = await fetchPendingDeletionDatasetIds(lakeId);
      const tokens =
        item.authTokens?.filter(
          (t) => t.token !== token && t.description !== DA_TOKEN_MARKER,
        ) ?? [];
      const mergedDatasetIds = Array.from(
        new Set(
          [...(item.datasetIds ?? []), ...datasetIds].filter((d) => !pendingDeletion.has(d)),
        ),
      );
      const body = {
        id: item.id ?? id,
        authTokens: [...tokens, authToken],
        datasetIds: mergedDatasetIds,
      };
      // The platform's fetch proxy times out at 30s (see AGENTS.md); a cold
      // Lake backend can take longer than that to answer a write even when it
      // lands fine. A timeout here is NOT proof the PUT failed — re-discover
      // before giving up, and only retry the write itself if it genuinely
      // didn't land.
      try {
        const updated = await request<{ items?: DirectAccessItem[] }>('PUT', base, body);
        item = updated.items?.[0] ?? (await getLakeDirectAccessSource(lakeId, id));
      } catch {
        item = await getLakeDirectAccessSource(lakeId, id);
        const landedAnyway =
          (item?.authTokens?.some((t) => t.token === token) ?? false) &&
          datasetIds.every((d) => (item?.datasetIds ?? []).includes(d));
        if (!landedAnyway) {
          const updated = await request<{ items?: DirectAccessItem[] }>('PUT', base, {
            ...body,
            id: item?.id ?? id,
          });
          item = updated.items?.[0] ?? (await getLakeDirectAccessSource(lakeId, id));
        }
      }
    }
  } else {
    // 2) Nothing to reuse — create one (this triggers first-time provisioning).
    // Same reasoning as above: a timeout on this POST doesn't mean the create
    // failed — re-discover before retrying, since retrying a POST against a
    // source that was actually created can 400/409 instead of helping.
    try {
      const created = await request<{ items?: DirectAccessItem[] }>('POST', base, {
        id,
        authTokens: [authToken],
        datasetIds,
      });
      item = created.items?.[0] ?? (await getLakeDirectAccessSource(lakeId, id));
    } catch {
      item = await getLakeDirectAccessSource(lakeId, id);
      if (!item) {
        const created = await request<{ items?: DirectAccessItem[] }>('POST', base, {
          id,
          authTokens: [authToken],
          datasetIds,
        });
        item = created.items?.[0] ?? (await getLakeDirectAccessSource(lakeId, id));
      }
    }
  }

  // 3) Wait for `status: "ready"` specifically — NOT just for an ingest URL to
  // exist. Confirmed live: adding/updating authTokens or datasetIds (steps
  // 1/2 above) flips `status` back to "provisioning" even on a source that
  // already has `ingestUrls` populated from an earlier successful provision.
  // Checking ingestUrls alone would return immediately on that stale value,
  // before the NEW config (the dataset/token we just added) has actually
  // redeployed — which is exactly how we got a 401 against a dataset that
  // was, by every other signal, correctly registered.
  for (
    let i = 0;
    i < 150 && item?.status !== 'ready' && !DIRECT_ACCESS_TERMINAL_FAILURE_STATUSES.has(item?.status ?? '');
    i += 1
  ) {
    await delay(4000);
    item = await getLakeDirectAccessSource(lakeId, id);
  }
  if (!item) {
    throw new Error(`Could not create or resolve Direct Access HTTP Source "${id}".`);
  }
  if (item.status !== 'ready') {
    throw new Error(
      `Direct Access HTTP Source "${id}" never reached "ready" (status: ${String(item.status)}) ` +
        `after ~10 minutes. This is a Cribl-side provisioning problem, not an app config issue — ` +
        `retrying likely won't help; check the source in the Cribl UI or contact Cribl Support.`,
    );
  }
  return item;
}

export async function deleteLakeDirectAccessSource(
  lakeId: string,
  _id: string,
): Promise<void> {
  void _id;
  await request('DELETE', directAccessBase(lakeId));
}

/**
 * Remove this app's OWN ingest tokens from the shared Direct Access HTTP Source,
 * leaving any tenant-configured tokens intact. Best-effort teardown — we never
 * delete the source itself (it may be shared / one-per-Lake).
 */
export async function pruneLakeDirectAccessTokens(
  lakeId: string,
  id: string,
): Promise<void> {
  const existing = await getLakeDirectAccessSource(lakeId, id);
  if (!existing) return;
  const kept = existing.authTokens?.filter((t) => t.description !== DA_TOKEN_MARKER) ?? [];
  if ((existing.authTokens?.length ?? 0) === kept.length) return; // nothing of ours
  await request('PUT', directAccessBase(lakeId), {
    id: existing.id ?? id,
    authTokens: kept,
  });
}

export async function listLakeDirectAccessIds(lakeId: string): Promise<string[]> {
  try {
    const data = await request<{ items?: DirectAccessItem[] }>('GET', directAccessBase(lakeId));
    return (data.items ?? []).map((i) => i.id).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Resolve the NDJSON ingest URL for a specific dataset from a Direct Access item.
 * The API returns URLs with a `<lake_dataset_id>` placeholder to be replaced with
 * the target dataset id, appended as a path segment (see Cribl Lake docs):
 *   https://direct-access-<x>.<tenant>.cribl.cloud:10080/datasets/<dataset_id>
 */
export function buildDatasetIngestUrl(item: DirectAccessItem, datasetId: string): string {
  const ndjson = item.ingestUrls?.find((u) => u.type === 'ndjson')?.url;
  const raw = ndjson ?? item.ingestUrl;
  if (!raw) {
    throw new Error('Direct Access HTTP Source did not return an NDJSON ingest URL.');
  }
  const encoded = encodeURIComponent(datasetId);
  if (/<[^>]*dataset[^>]*>/i.test(raw)) {
    return raw.replace(/<[^>]*dataset[^>]*>/i, encoded);
  }
  const trimmed = raw.replace(/\/+$/, '');
  return /\/datasets$/i.test(trimmed) ? `${trimmed}/${encoded}` : `${trimmed}/datasets/${encoded}`;
}

/**
 * Best-effort, single GET to surface the Direct Access host:port BEFORE the
 * SE has to run (and watch fail) a full deploy to read it out of the
 * "Domain ... is not declared in proxies.yml" error. This is a direct Cribl
 * API call (not routed through this app's own proxies.yml), so it works even
 * when External API Access hasn't been configured yet. Returns undefined if
 * the source doesn't exist yet or hasn't been assigned a host (first-ever
 * provision in this org/Lake) — callers should fall back to "deploy once".
 */
export async function peekDirectAccessHost(
  lakeId: string,
  sourceId: string,
): Promise<string | undefined> {
  const item = await getLakeDirectAccessSource(lakeId, sourceId);
  const raw = item?.ingestUrls?.find((u) => u.type === 'ndjson')?.url ?? item?.ingestUrl;
  if (!raw) return undefined;
  try {
    return new URL(raw).host;
  } catch {
    return undefined;
  }
}

/**
 * Resolve the NDJSON ingest URL for a dataset, polling the Direct Access source
 * until its ingest URL is provisioned (create/PUT can return before the endpoint
 * is ready). On persistent failure, throws a diagnostic that distinguishes "still
 * provisioning" from a structural problem (what URL types / status came back).
 */
export async function resolveDatasetIngestUrl(
  lakeId: string,
  sourceId: string,
  datasetId: string,
  tries = 20,
  delayMs = 4000,
): Promise<string> {
  let lastItem: DirectAccessItem | undefined;
  for (let i = 0; i < tries; i += 1) {
    lastItem = await getLakeDirectAccessSource(lakeId, sourceId);
    const raw =
      lastItem?.ingestUrls?.find((u) => u.type === 'ndjson')?.url ?? lastItem?.ingestUrl;
    if (raw) return buildDatasetIngestUrl(lastItem as DirectAccessItem, datasetId);
    await delay(delayMs);
  }
  if (!lastItem) {
    throw new Error(`Direct Access HTTP Source "${sourceId}" not found — cannot backfill.`);
  }
  const types = lastItem.ingestUrls?.map((u) => u.type).join(', ') || 'none';
  const status =
    typeof lastItem.status === 'string'
      ? lastItem.status
      : JSON.stringify(lastItem.status ?? null);
  throw new Error(
    `Direct Access HTTP Source "${sourceId}" returned no NDJSON ingest URL after ` +
      `${tries} checks (~${Math.round((tries * delayMs) / 1000)}s). ingestUrl types: ${types}; ` +
      `status: ${status}. If it is still provisioning, redeploy in a minute.`,
  );
}

/**
 * POST a batch of NDJSON lines to a Lake Direct Access ingest URL. The auth token
 * is NOT sent here — the platform proxy injects it from KV per `proxies.yml`
 * (browser-set `Authorization` headers are stripped by the proxy). Returns the
 * number of lines posted. Throws with the response body on non-2xx.
 */
export async function postNdjsonToLake(url: string, lines: string[]): Promise<number> {
  if (lines.length === 0) return 0;
  const body = lines.join('\n');
  // Direct Access uses timestamp-based versioning and triggers an async
  // redeploy whenever auth tokens (or dataset allowlists) change (confirmed
  // in Cribl's own Lake release notes) — registering our token on the
  // source (see `ensureLakeDirectAccessSource`) can return success before
  // that redeploy has actually reached the Direct Access worker group, so
  // the very next ingest POST can 401 on a token that IS correctly
  // registered, just not live yet. Retry only on 401, with a short backoff;
  // any other status fails immediately as a real error.
  const maxAttempts = 6;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-ndjson' },
      body,
    });
    if (res.ok) return lines.length;
    const text = await res.text().catch(() => '');
    if (res.status === 401 && attempt < maxAttempts) {
      await delay(5000);
      continue;
    }
    throw new Error(
      `Lake ingest failed: ${res.status} ${res.statusText}: ${text.slice(0, 200)}`.trim(),
    );
  }
  // Unreachable (the loop always returns or throws), but keeps TS happy.
  return 0;
}

/* ---------------- Cribl Search — Lakehouse (search-engine) datasets ---------- */

/**
 * Upsert a Lakehouse (search-engine) Dataset linked to an existing engine
 * (e.g. quick_search). Unlike a federated `cribl_lake` dataset, this is a
 * `cribl_search`/`provider: lakehouse` dataset tied to `engine`, matching what
 * the Search UI creates when you pick "Search engine" instead of "Federated".
 * Idempotent via upsertMulti.
 */
export async function upsertSearchDataset(
  id: string,
  config: Record<string, unknown>,
): Promise<void> {
  await upsertMulti(searchBases('datasets'), id, {
    ...config,
    id,
    type: 'cribl_search',
    provider: 'lakehouse',
  });
}

export async function deleteSearchDataset(id: string): Promise<void> {
  await deleteMulti(searchBases('datasets'), id);
}

/**
 * Best-effort: attach a description + tags to a Cribl Lake dataset's federated
 * Search entry so the AI Investigator discovers and selects it. Cribl Lake
 * datasets are auto-registered as federated Search datasets (`dataset="<id>"`),
 * so we PATCH the auto-registered entry rather than creating a duplicate. Any
 * failure is swallowed — discovery still works from the dataset's own
 * description, so this must never fail a deploy.
 */
export async function tagFederatedSearchDataset(
  id: string,
  meta: { description?: string; tags?: string[] },
): Promise<void> {
  for (const base of searchBases('datasets')) {
    try {
      await request('PATCH', `${base}/${encodeURIComponent(id)}`, { id, ...meta });
      return;
    } catch {
      /* try next base */
    }
  }
}

/**
 * Best-effort: bind a datatype onto an already-created v1 dataset (Lake or
 * Lakehouse — both use this same flat top-level `breakerRulesets` field) so
 * events are classified/parsed natively instead of relying on search-time
 * `extract()` alone — e.g. Palo Alto traffic resolves to `pan_traffic`
 * (source_ip, action, bytes, …) via the "Palo Alto Datatypes" datatype.
 * PATCHed AFTER creation, not included in the create call, since the Lake
 * dataset create API rejects this as an additional property at create time
 * (see the NOTE in `deploymentPlanner.ts`). Verified live against the
 * workspace's own `default_logs`/`default_metrics`/`default_spans` and our
 * Palo Alto demo dataset, all of which carry this as a flat field, not
 * nested under `searchConfig` as the bundled (stale, for this) openapi.json
 * suggests.
 *
 * Any failure is swallowed — the dataset is still fully searchable via
 * search-time parsing, so this must never fail a deploy.
 */
export async function applyDatasetBreakerRuleset(
  id: string,
  breakerRuleset: string,
): Promise<void> {
  for (const base of searchBases('datasets')) {
    try {
      await request('PATCH', `${base}/${encodeURIComponent(id)}`, {
        id,
        breakerRulesets: [breakerRuleset],
      });
      return;
    } catch {
      /* try next base */
    }
  }
}

/**
 * Best-effort: switch a Lake dataset to search execution v2 and bind a
 * path-filter datatype — a glob-to-Datatype mapping on the Lake bucket path,
 * rather than v1's direct `breakerRulesets` binding. Verified live: the
 * CrowdStrike demo dataset parses cleanly on v2 with a `**\/*.json.gz` glob
 * (matching the gzip-JSON files our `cribl_lake` output writes) mapped to
 * the `falcon_events` datatype, where v1 did not. Both fields (`searchVersion`
 * and `paths`) are flat/top-level on the live dataset object, confirmed via
 * `cribl_getSearchContext`'s dataset listing — not nested under
 * `searchConfig.pathFilters` as the bundled openapi.json's CREATE/PATCH
 * schema describes (another place that schema is stale).
 *
 * Any failure is swallowed — the dataset is still fully searchable via
 * search-time parsing, so this must never fail a deploy.
 */
export async function applyDatasetV2PathFilterDatatype(
  id: string,
  dataTypeId: string,
  filterGlob = '**/*.json.gz',
  dataPathFormat: 'ndjson' | 'parquet' = 'ndjson',
): Promise<void> {
  for (const base of searchBases('datasets')) {
    try {
      await request('PATCH', `${base}/${encodeURIComponent(id)}`, {
        id,
        searchVersion: 'v2',
        paths: [{ filters: [{ filter: filterGlob, dataTypeId, dataPathFormat }] }],
      });
      return;
    } catch {
      /* try next base */
    }
  }
}

/**
 * Create/update a Local Search ingest Source so the Lakehouse engine listens on
 * our chosen port. The matching `cribl_search_engine` destination sends here.
 * Idempotent via upsertMulti.
 */
export async function upsertLocalSearchSource(
  id: string,
  config: Record<string, unknown>,
): Promise<void> {
  await upsertMulti(searchBases('local_search/sources'), id, { ...config, id });
}

export async function deleteLocalSearchSource(id: string): Promise<void> {
  await deleteMulti(searchBases('local_search/sources'), id);
}

/** List Local Search ingest source ids (for prefix-based cleanup). */
export async function listLocalSearchSourceIds(): Promise<string[]> {
  return listSearchIds('local_search/sources');
}

interface DatasetRule {
  id: string;
  name?: string;
  description?: string;
  kustoExpression: string;
  sendDataTo?: string;
  dataset?: string;
  [k: string]: unknown;
}
interface DatasetRuleset {
  id: string;
  rules: DatasetRule[];
}

/**
 * Fetch the Lakehouse engine dataset ruleset(s) from the first base that
 * answers. Returns the base that worked so callers PATCH the same one.
 */
async function fetchDatasetRulesets(): Promise<{
  base: string;
  rulesets: DatasetRuleset[];
}> {
  let lastErr: unknown;
  for (const base of searchBases('local_search/dataset-rulesets')) {
    try {
      const data = await request<{ items?: DatasetRuleset[] }>('GET', base);
      return { base, rulesets: data.items ?? [] };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error('No Local Search dataset ruleset endpoint responded');
}

/** Pick the ruleset to route into: prefer one matching the engine, else default. */
function pickRuleset(
  rulesets: DatasetRuleset[],
  engineId: string,
): DatasetRuleset | undefined {
  return (
    rulesets.find((r) => r.id === engineId) ??
    rulesets.find((r) => r.id === 'default') ??
    rulesets[0]
  );
}

/**
 * Route a Lakehouse engine's ingested events to our dataset by adding a
 * dataset-ruleset rule that matches on the ingest source id:
 * `__inputId == 'cribl_http:<sourceId>'`. Without this rule the engine drops
 * events that don't match an existing (e.g. catch-all `*`) rule's dataset, so
 * this is what actually lands data in the per-demo Search dataset.
 *
 * We PREPEND our rule so it wins over any trailing `*` catch-all (first match
 * wins), and dedupe by rule id so re-deploys are idempotent.
 */
export async function addDatasetRoute(
  engineId: string,
  datasetId: string,
  sourceId: string,
): Promise<void> {
  const { base, rulesets } = await fetchDatasetRulesets();
  const ruleset = pickRuleset(rulesets, engineId);
  if (!ruleset) {
    throw new Error('No Local Search dataset ruleset found to add a route to');
  }
  const rule: DatasetRule = {
    id: datasetId,
    name: datasetId.slice(0, 256),
    description: 'SE Demo Launcher route',
    kustoExpression: `__inputId == 'cribl_http:${sourceId}'`,
    sendDataTo: 'destinationDataset',
    dataset: datasetId,
  };
  const rules = [rule, ...ruleset.rules.filter((r) => r.id !== datasetId)];
  await request('PATCH', `${base}/${encodeURIComponent(ruleset.id)}`, {
    id: ruleset.id,
    rules,
  });
}

/** Remove any dataset-ruleset rule that routes to `datasetId` (best-effort). */
export async function removeDatasetRoute(datasetId: string): Promise<void> {
  const { base, rulesets } = await fetchDatasetRulesets();
  for (const rs of rulesets) {
    if (!rs.rules.some((r) => r.id === datasetId || r.dataset === datasetId)) {
      continue;
    }
    const rules = rs.rules.filter(
      (r) => r.id !== datasetId && r.dataset !== datasetId,
    );
    await request('PATCH', `${base}/${encodeURIComponent(rs.id)}`, {
      id: rs.id,
      rules,
    });
  }
}

/**
 * Resolve the Lakehouse ingest hostname (e.g. `search.main.<org>.cribl.cloud`)
 * that a `cribl_search_engine` destination must target.
 *
 * The Cribl.Cloud API host is `<workspace>-<org>.cribl.cloud` (e.g.
 * `main-determined-mcclintock-0bhjgg2.cribl.cloud`), but the search ingest host is
 * `search.<workspace>.<org>.cribl.cloud` — the FIRST hyphen (the workspace↔org
 * separator) becomes a dot. So we derive it from CRIBL_API_URL by replacing only
 * the first hyphen, then prefixing `search.`. `String.replace(string, …)` only
 * replaces the first occurrence, so the org's own hyphens are preserved.
 *
 * We deliberately do NOT copy the host from an existing `cribl_search_engine`
 * destination: those can carry the wrong (hyphenated) form, which is exactly the
 * bug this replaces.
 */
export function resolveSearchIngestHost(): string | undefined {
  try {
    const apiHost = new URL(apiBase()).hostname; // <workspace>-<org>.cribl.cloud
    if (!apiHost) return undefined;
    return `search.${apiHost.replace('-', '.')}`;
  } catch {
    return undefined;
  }
}

/**
 * Resolve the Cribl.Cloud ingest hostname for an arbitrary worker group's
 * custom HTTP/OTel-type source, e.g. `default.main.<org>.cribl.cloud` for
 * group `default` (confirmed convention — Cribl docs' Raw HTTP/S, HTTP Bulk,
 * and Data Firehose source pages all show `<groupId>.<workspace>.<org>.cribl.cloud`).
 * This is the GENERAL form; `resolveSearchIngestHost` above is a special case
 * for Cribl Search's own product-level alias (`search.`, not the literal
 * `default_search` group id) and is unrelated to this one.
 */
export function resolveGroupIngestHost(groupId: string): string | undefined {
  try {
    const apiHost = new URL(apiBase()).hostname; // <workspace>-<org>.cribl.cloud
    if (!apiHost) return undefined;
    return `${groupId}.${apiHost.replace('-', '.')}`;
  } catch {
    return undefined;
  }
}

/**
 * Pack ids the real "AI Observability" app installs once its Setup Wizard
 * has run — confirmed live against an actual installed org (`GET
 * /m/:gid/packs` listed `ai-o11y` and `ai-o11y-ingestion`), not guessed from
 * the package's README/policies.yml prose (an earlier version of this
 * detection keyed off pipeline NAMES mentioned in that prose, which turned
 * out not to exist as real objects at all — this is the corrected version).
 * Finding either pack in a group is the strongest available indirect signal
 * that group hosts the app's ingestion setup; it is NOT a substitute for
 * checking `/apps` (which we can't call — cross-app-blocked).
 */
const AI_OBSERVABILITY_SIGNAL_PACK_IDS = ['ai-o11y-ingestion', 'ai-o11y'];

/**
 * True for the app's OTLP/HTTP listener specifically (not its gRPC sibling,
 * nor the separate raw-HTTP/relay gates the README also mentions for other
 * vendor sources) — confirmed live: `type: 'open_telemetry'`,
 * `protocol: 'http'`, found at `ai-o11y-otelHttp` on port 20006 inside the
 * `ai-o11y-ingestion` pack.
 *
 * Also confirmed live: the base `ai-o11y` pack ships an input with the exact
 * same id/type/protocol (on a different port) that is NOT actually wired up
 * — `sendToRoutes: false`, `pipeline: null`. Without excluding it, a org with
 * both packs installed (the normal case — `ai-o11y-ingestion` depends on
 * `ai-o11y`) always finds two candidates and detection falls back to "not
 * found" even when the real listener is right there. `sendToRoutes` is the
 * live/inert distinguisher.
 */
function isOtlpHttpListener(input: Record<string, unknown>): boolean {
  return (
    String(input.type ?? '') === 'open_telemetry' &&
    String(input.protocol ?? '') === 'http' &&
    input.sendToRoutes === true
  );
}

/**
 * Best-effort detection of the real "AI Observability" app's OTLP/HTTP
 * ingest host:port, for autofilling the use case's config field. We cannot
 * ask the platform directly whether the app is installed (`/apps` is
 * cross-app-blocked from inside any Cribl App, including this one) — so
 * instead: for every worker group, list its installed packs (one GET); if
 * either known AI Observability pack id is present, scan that SAME pack's
 * inputs (and the group's own bare inputs, belt-and-suspenders) for the
 * OTLP/HTTP listener. Returns a single `host:port` only when exactly one
 * such listener is found across the whole org; returns `undefined` on no
 * match OR on more than one candidate (ambiguous is treated the same as
 * absent — we never guess which one is right).
 */
export async function detectAiObservabilityOtlpHost(): Promise<string | undefined> {
  let groups: WorkerGroupRef[];
  try {
    groups = await listWorkerGroups();
  } catch {
    return undefined;
  }

  const perGroupResults = await Promise.all(
    groups.map(async (g): Promise<string[]> => {
      const host = resolveGroupIngestHost(g.id);
      if (!host) return [];

      let packIds: string[];
      try {
        packIds = await listPackIds(g.id);
      } catch {
        return []; // Can't list this group's packs — not a candidate.
      }
      const signalPackIds = packIds.filter((id) => AI_OBSERVABILITY_SIGNAL_PACK_IDS.includes(id));
      if (signalPackIds.length === 0) return [];

      const found: string[] = [];

      try {
        for (const input of await listGroupInputConfigs(g.id)) {
          if (isOtlpHttpListener(input)) found.push(`${host}:${Number(input.port)}`);
        }
      } catch {
        // Ignore — the listener is expected to be pack-scoped, not bare.
      }

      const perPack = await Promise.all(
        signalPackIds.map(async (packId): Promise<string[]> => {
          try {
            return (await listPackInputConfigs(g.id, packId))
              .filter(isOtlpHttpListener)
              .map((input) => `${host}:${Number(input.port)}`);
          } catch {
            return []; // One unreadable pack shouldn't block checking the rest.
          }
        }),
      );
      found.push(...perPack.flat());

      return found;
    }),
  );

  const candidates = new Set(perGroupResults.flat());
  return candidates.size === 1 ? [...candidates][0] : undefined;
}

/**
 * Origin of the Cribl UI (same host as the API, minus `/api/v1`), e.g.
 * `https://main-<org>.cribl.cloud`. Used to build deep links to deployed assets
 * (QuickConnect, Search dashboards, datasets). Returns `undefined` if the API
 * URL isn't available (dev preview).
 */
export function criblUiOrigin(): string | undefined {
  try {
    return new URL(apiBase()).origin;
  } catch {
    return undefined;
  }
}

/** Upsert a saved search (Cribl Search). */
export async function upsertSavedSearch(
  id: string,
  config: Record<string, unknown>,
): Promise<void> {
  await upsertMulti(searchBases('saved'), id, { ...config, id });
}

export async function deleteSavedSearch(id: string): Promise<void> {
  await deleteMulti(searchBases('saved'), id);
}

/** Upsert a Cribl Search dashboard. */
export async function upsertDashboard(
  id: string,
  config: Record<string, unknown>,
): Promise<void> {
  await upsertMulti(searchBases('dashboards'), id, { ...config, id });
}

export async function deleteDashboard(id: string): Promise<void> {
  await deleteMulti(searchBases('dashboards'), id);
}

/**
 * Commit and deploy the group config so QuickConnect objects take effect on
 * Workers. Best-effort: errors are surfaced to the caller, which treats this as
 * non-fatal (config is still saved and visible in the UI).
 *
 * Flow: commit pending group changes (POST /m/{groupId}/version/commit), then
 * deploy that commit to the group (PATCH /master/groups/{id}/deploy). If there
 * is nothing to commit (idempotent redeploy), the deploy is skipped.
 */
export async function commitAndDeploy(groupId: string): Promise<void> {
  const commit = await request<{ items?: Array<{ commit?: string }> }>(
    'POST',
    `${groupBase(groupId)}/version/commit`,
    { message: 'SE Demo Launcher deploy' },
  );
  const version = commit?.items?.[0]?.commit;
  if (!version) {
    // Nothing to commit → nothing to deploy. Safe for repeated runs.
    return;
  }
  await request(
    'PATCH',
    `${apiBase()}/master/groups/${encodeURIComponent(groupId)}/deploy`,
    { version },
  );
}
