import type { SchemaField, SourceProfile, StreamInputKind } from '../types';

/**
 * Builds an ad-hoc, SE-supplied `SourceProfile` at selection time, instead of
 * looking one up from the static registry (`sourceProfiles.ts`). Lets an SE
 * bring their own sample data rather than being limited to the curated list.
 *
 * Reuses the SAME `replaySample` + replay-pipeline mechanism already proven in
 * production for the Windows/Linux/Claude-Code/security sources (see
 * `deploymentPlanner.ts`'s `buildReplayPipelineConf`) — an upload is just a
 * `ReplaySample` sourced from the SE instead of bundled in code. No new Cribl-
 * side mechanism, and no new teardown surface: it rides the same
 * `demo_pipe_<token>`/`demo_inject_<token>` pipeline objects the replay
 * mechanism already creates and the existing reset flow already removes.
 */

/** Hard caps: oversized input is REJECTED with a clear message, never silently truncated. */
export const MAX_UPLOAD_BYTES = 256 * 1024; // 256KB
export const MAX_UPLOAD_LINES = 200;

export class UploadValidationError extends Error {}

/** Parsed, validated lines from an SE-supplied sample (one event per line). */
export interface ParsedUpload {
  lines: string[];
  /** True if every non-empty line parsed as a JSON object (NDJSON-shaped). */
  isJson: boolean;
}

/**
 * Split raw uploaded/pasted text into event lines, enforcing the size/line
 * caps. Throws `UploadValidationError` with a clear, SE-facing message instead
 * of truncating — the SE should know their sample was rejected, not silently
 * shortened.
 */
export function parseUploadedSample(raw: string): ParsedUpload {
  if (raw.length > MAX_UPLOAD_BYTES) {
    throw new UploadValidationError(
      `Sample is ${Math.ceil(raw.length / 1024)}KB — the limit is ${Math.round(MAX_UPLOAD_BYTES / 1024)}KB. Trim it and try again.`,
    );
  }
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    throw new UploadValidationError('No event lines found — paste or upload at least one line.');
  }
  if (lines.length > MAX_UPLOAD_LINES) {
    throw new UploadValidationError(
      `Sample has ${lines.length} lines — the limit is ${MAX_UPLOAD_LINES} for a demo replay set. Trim it and try again.`,
    );
  }

  // Datagen replays a random line from the set on every tick — a representative
  // sample this small is sufficient, no need for the SE's whole file.
  const isJson = lines.every((l) => {
    try {
      const parsed = JSON.parse(l) as unknown;
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
    } catch {
      return false;
    }
  });

  return { lines, isJson };
}

/** Best-effort schema inference for the review screen's "Sample fields" panel. */
function inferSampleSchema(parsed: ParsedUpload): SchemaField[] {
  if (!parsed.isJson) {
    return [{ name: 'message', type: 'string', example: parsed.lines[0].slice(0, 80) }];
  }
  try {
    const first = JSON.parse(parsed.lines[0]) as Record<string, unknown>;
    return Object.entries(first)
      .slice(0, 8)
      .map(([name, value]) => ({
        name,
        type: typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'string',
        example: String(value).slice(0, 60),
      }));
  } catch {
    return [{ name: 'message', type: 'string', example: parsed.lines[0].slice(0, 80) }];
  }
}

/** Stable-enough id suffix for this session — not globally deduped (one custom source per scenario). */
function randomSuffix(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Fixed listener port reserved for the "upload your own sample" path. */
const CUSTOM_UPLOAD_PORT = 21030;

export interface CustomUploadOptions {
  displayName: string;
  protocolLabel: string;
  streamInputKind: StreamInputKind;
  raw: string;
}

/**
 * Build an ad-hoc `SourceProfile` from SE-supplied sample text. NOT added to
 * the static `sourceProfileById` registry — the caller carries it on
 * `ScenarioSelection.customSource` instead (see `domain/types.ts`), and the
 * planner resolves `customSource` ahead of a registry lookup.
 */
export function buildUploadedSourceProfile(opts: CustomUploadOptions): SourceProfile {
  const parsed = parseUploadedSample(opts.raw);
  const loopListenerKind = opts.streamInputKind === 'syslog' ? 'syslog' : 'tcp';
  const token = randomSuffix();

  return {
    id: `src-custom-${token}`,
    family: 'security-lake',
    displayName: opts.displayName,
    summary: 'SE-supplied sample data, uploaded for this demo run.',
    protocol: opts.protocolLabel,
    streamInputKind: opts.streamInputKind,
    loopListenerKind,
    // Unique per upload so it never collides with a curated/registry pack mapping
    // (packForDatagenSample intentionally has no entry for this — uploads always
    // fall back to a generic custom-pipeline processing profile).
    datagenSample: `custom_upload_${token}`,
    defaultPort: CUSTOM_UPLOAD_PORT,
    sampleSchema: inferSampleSchema(parsed),
    compatibleDestinations: ['siem-analytics', 'low-cost-store', 'operations', 'compliance-archive'],
    parsingAssumptions: [
      'SE-supplied sample — no bundled parser guarantee',
      parsed.isJson ? 'Detected as JSON-lines (one JSON object per line)' : 'Detected as raw line-delimited text',
      'Processed with a generic custom pipeline (no matching Cribl Pack)',
    ],
    sampleFeed: {
      method: 'cribl-datagen',
      internalTemplateRef: `replay:custom-upload-${token}`,
      approxEventsPerSecond: 20,
      maintainerNote: `SE-uploaded sample (${parsed.lines.length} lines), capped at ${MAX_UPLOAD_LINES} lines / ${Math.round(MAX_UPLOAD_BYTES / 1024)}KB.`,
    },
    replaySample: {
      events: parsed.lines,
      sourcetype: 'custom:uploaded',
      source: 'se-demo-launcher-upload',
    },
  };
}
