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

/** List all input ids in a worker group (used for tag/prefix-based cleanup). */
export async function listInputIds(groupId: string): Promise<string[]> {
  return listIds(`${groupBase(groupId)}/system/inputs`);
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
export async function resolveAvailableDatasetId(
  lakeId: string,
  baseId: string,
): Promise<string> {
  const pendingDeletion = new Set<string>();
  try {
    const data = await request<{
      items?: Array<{ id?: string; deletionStartedAt?: number }>;
    }>('GET', `${apiBase()}/products/lake/lakes/${encodeURIComponent(lakeId)}/datasets`);
    for (const d of data.items ?? []) {
      if (d.id && d.deletionStartedAt) pendingDeletion.add(String(d.id));
    }
  } catch {
    return baseId;
  }
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

/** Store a value in this app's scoped KV store (used for the ingest token). */
export async function putKvValue(key: string, value: string): Promise<void> {
  await request('PUT', `${apiBase()}/kvstore/${encodeURIComponent(key)}`, value);
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
  ingestUrl?: string;
  ingestUrls?: DirectAccessIngestUrl[];
  status?: unknown;
}

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
): Promise<DirectAccessItem> {
  const base = directAccessBase(lakeId);
  const authToken = { token, description: DA_TOKEN_MARKER };

  // 1) Discover an existing source and reuse it.
  let item = await getLakeDirectAccessSource(lakeId, id);
  if (item) {
    const hasOurToken = item.authTokens?.some((t) => t.token === token) ?? false;
    if (!hasOurToken) {
      // Register our token without disturbing tenant tokens; prune our own stale
      // ones so the source doesn't accumulate one token per deploy.
      const tokens =
        item.authTokens?.filter(
          (t) => t.token !== token && t.description !== DA_TOKEN_MARKER,
        ) ?? [];
      const updated = await request<{ items?: DirectAccessItem[] }>('PUT', base, {
        id: item.id ?? id,
        authTokens: [...tokens, authToken],
      });
      item = updated.items?.[0] ?? (await getLakeDirectAccessSource(lakeId, id));
    }
  } else {
    // 2) Nothing to reuse — create one (this triggers first-time provisioning).
    const created = await request<{ items?: DirectAccessItem[] }>('POST', base, {
      id,
      authTokens: [authToken],
    });
    item = created.items?.[0] ?? (await getLakeDirectAccessSource(lakeId, id));
  }

  // 3) Wait for the ingest URL ONLY if it isn't ready yet (freshly provisioned
  //    sources need a few minutes; reused ones return immediately).
  for (let i = 0; i < 45 && !item?.ingestUrls?.length && !item?.ingestUrl; i += 1) {
    await delay(4000);
    item = await getLakeDirectAccessSource(lakeId, id);
  }
  if (!item) {
    throw new Error(`Could not create or resolve Direct Access HTTP Source "${id}".`);
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
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-ndjson' },
    body: lines.join('\n'),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `Lake ingest failed: ${res.status} ${res.statusText}: ${text.slice(0, 200)}`.trim(),
    );
  }
  return lines.length;
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
