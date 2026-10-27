/**
 * Bundled Claude Code (OpenTelemetry) AI-telemetry sample set (SE Demo Launcher).
 *
 * These are real-shaped Claude Code Enterprise OTel *events* (logs), one JSON
 * object per line, modeled on the documented schema:
 *   - claude_code.api_request  → model, token breakdown, cost, duration (the
 *     workhorse events that carry cost/token/model/user analytics)
 *   - claude_code.user_prompt  → prompt text (captured only with
 *     OTEL_LOG_USER_PROMPTS=1); drives subject classification
 *   - claude_code.tool_decision / tool_result → tool activity + accept/reject
 *
 * We ship our own events (rather than a Cribl built-in datagen template, which
 * has no Claude Code sample) so the AI demo is deterministic: an internal
 * generator acts only as a clock and a replay pipeline injects one of these
 * JSON records as `_raw` on each tick. A processing pipeline then parses the
 * OTel JSON, derives `total_tokens`, and classifies the prompt `subject`.
 *
 * Field names are the flattened, snake_case form the enrichment pipeline
 * normalizes OTel attributes into, so Search dashboards can query them directly.
 * Timestamps are intentionally omitted so each replayed event lands at ingest
 * time and shows up in the dashboards' recent-time windows.
 */

interface Person {
  user_id: string;
  user_email: string;
  team_id: string;
}

const ORG_ID = 'org_8f4ac21e';

const PEOPLE: Person[] = [
  { user_id: 'chris_carter', user_email: 'chris.carter@bazookatron.io', team_id: 'platform-eng' },
  { user_id: 'a_smith', user_email: 'a.smith@bazookatron.io', team_id: 'platform-eng' },
  { user_id: 'jesse_james', user_email: 'jesse.james@bazookatron.io', team_id: 'payments' },
  { user_id: 'dana_lin', user_email: 'dana.lin@bazookatron.io', team_id: 'data-platform' },
  { user_id: 'mo_okafor', user_email: 'mo.okafor@bazookatron.io', team_id: 'security' },
  { user_id: 'priya_nair', user_email: 'priya.nair@bazookatron.io', team_id: 'frontend' },
  { user_id: 'sam_reyes', user_email: 'sam.reyes@bazookatron.io', team_id: 'sre' },
  { user_id: 'lee_zhang', user_email: 'lee.zhang@bazookatron.io', team_id: 'data-platform' },
];

const MODELS = ['claude-opus-4-1', 'claude-sonnet-4-5', 'claude-haiku-4-5'] as const;

/** Prompt text keyed by the subject the enrichment pipeline should classify it as. */
const PROMPTS: Array<{ subject: string; prompt: string }> = [
  { subject: 'Debugging', prompt: 'debug why the checkout service throws a null pointer on refund' },
  { subject: 'Debugging', prompt: 'help me fix this failing unit test and the stack trace error' },
  { subject: 'Refactoring', prompt: 'refactor this module to extract the retry logic into a helper' },
  { subject: 'Refactoring', prompt: 'clean up and refactor the pagination code in the order api' },
  { subject: 'Test Generation', prompt: 'write jest tests for the inventory-sync reducer' },
  { subject: 'Test Generation', prompt: 'generate unit tests covering the edge cases for parseAmount' },
  { subject: 'Code Review', prompt: 'review this pull request diff for security and style issues' },
  { subject: 'Infrastructure / Terraform', prompt: 'apply terraform to add an eks node group in gov-east' },
  { subject: 'Infrastructure / Terraform', prompt: 'write a terraform module for the s3 retention bucket' },
  { subject: 'Documentation', prompt: 'document the public functions in the catalog-service readme' },
  { subject: 'Data Pipelines', prompt: 'build a dataflow to aggregate daily token usage by team' },
  { subject: 'Security Review', prompt: 'audit this auth handler for injection and secret leakage' },
  { subject: 'SQL & Databases', prompt: 'optimize this slow postgres query with the right index' },
  { subject: 'API Integration', prompt: 'integrate the stripe refund webhook into the payments api' },
  { subject: 'Frontend / UI', prompt: 'build a react settings panel with a dark mode toggle' },
  { subject: 'Incident Response', prompt: 'summarize the incident timeline from these error logs' },
];

const REPOS = [
  'bazookatron/order-api',
  'bazookatron/checkout-payments',
  'bazookatron/inventory-sync',
  'bazookatron/catalog-service',
  'bazookatron/storefront-web',
  'bazookatron/data-pipelines',
];

const TOOLS = ['Edit', 'Bash', 'Read', 'Write', 'Grep', 'WebFetch'];

/** Small deterministic PRNG so the bundled set is stable across builds. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rnd = mulberry32(20260713);
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)];
const between = (min: number, max: number): number => Math.round(min + rnd() * (max - min));

/** Anthropic public per-1M-token pricing (approx) used to derive event cost. */
function costUsd(model: string, inTok: number, outTok: number, cacheRead: number, cacheCreate: number): number {
  const rate =
    model === 'claude-opus-4-1'
      ? { in: 15, out: 75, cr: 1.5, cc: 18.75 }
      : model === 'claude-haiku-4-5'
        ? { in: 1, out: 5, cr: 0.1, cc: 1.25 }
        : { in: 3, out: 15, cr: 0.3, cc: 3.75 };
  const c =
    (inTok / 1e6) * rate.in +
    (outTok / 1e6) * rate.out +
    (cacheRead / 1e6) * rate.cr +
    (cacheCreate / 1e6) * rate.cc;
  return Math.round(c * 10000) / 10000;
}

function buildEvents(): string[] {
  const events: string[] = [];
  // Weight toward api_request events (they carry the cost/token analytics), with
  // a healthy set of user_prompt events (subject story) and some tool activity.
  const API_REQUESTS = 70;
  const USER_PROMPTS = 34;
  const TOOL_EVENTS = 24;

  for (let i = 0; i < API_REQUESTS; i += 1) {
    const p = pick(PEOPLE);
    const model = pick(MODELS);
    const input = between(1200, 14000);
    const output = between(400, 6000);
    const cacheRead = between(8000, 120000);
    const cacheCreate = between(0, 18000);
    events.push(
      JSON.stringify({
        event_name: 'claude_code.api_request',
        organization_id: ORG_ID,
        user_id: p.user_id,
        user_email: p.user_email,
        team_id: p.team_id,
        session_id: `sess_${p.user_id}_${between(1, 6)}`,
        model,
        input_tokens: input,
        output_tokens: output,
        cache_read_tokens: cacheRead,
        cache_creation_tokens: cacheCreate,
        cost_usd: costUsd(model, input, output, cacheRead, cacheCreate),
        duration_ms: between(600, 12000),
        repo: pick(REPOS),
      }),
    );
  }

  for (let i = 0; i < USER_PROMPTS; i += 1) {
    const p = pick(PEOPLE);
    const pr = pick(PROMPTS);
    events.push(
      JSON.stringify({
        event_name: 'claude_code.user_prompt',
        organization_id: ORG_ID,
        user_id: p.user_id,
        user_email: p.user_email,
        team_id: p.team_id,
        session_id: `sess_${p.user_id}_${between(1, 6)}`,
        model: pick(MODELS),
        prompt: pr.prompt,
        prompt_length: pr.prompt.length,
        repo: pick(REPOS),
      }),
    );
  }

  for (let i = 0; i < TOOL_EVENTS; i += 1) {
    const p = pick(PEOPLE);
    const isDecision = rnd() > 0.5;
    const tool = pick(TOOLS);
    events.push(
      JSON.stringify(
        isDecision
          ? {
              event_name: 'claude_code.tool_decision',
              organization_id: ORG_ID,
              user_id: p.user_id,
              user_email: p.user_email,
              team_id: p.team_id,
              session_id: `sess_${p.user_id}_${between(1, 6)}`,
              tool_name: tool,
              decision: rnd() > 0.2 ? 'accept' : 'reject',
            }
          : {
              event_name: 'claude_code.tool_result',
              organization_id: ORG_ID,
              user_id: p.user_id,
              user_email: p.user_email,
              team_id: p.team_id,
              session_id: `sess_${p.user_id}_${between(1, 6)}`,
              tool_name: tool,
              success: rnd() > 0.15,
              duration_ms: between(20, 4000),
            },
      ),
    );
  }

  return events;
}

export const claudeCodeTelemetryEvents: string[] = buildEvents();

export const claudeCodeTelemetryMeta = {
  sourcetype: 'claude_code:otel',
  source: 'otel:claude_code',
  index: 'ai_telemetry',
};

/** Subject keywords the enrichment pipeline uses to classify `user_prompt` events. */
export const subjectKeywords: Array<{ subject: string; pattern: string }> = [
  { subject: 'Debugging', pattern: 'debug|stack trace|null pointer|failing|error|bug' },
  { subject: 'Refactoring', pattern: 'refactor|clean up|extract|rename' },
  { subject: 'Test Generation', pattern: 'test|jest|unit test|coverage' },
  { subject: 'Code Review', pattern: 'review|pull request|diff' },
  { subject: 'Infrastructure / Terraform', pattern: 'terraform|eks|node group|infra|bucket' },
  { subject: 'Documentation', pattern: 'document|readme|docs' },
  { subject: 'Data Pipelines', pattern: 'dataflow|pipeline|aggregate|etl' },
  { subject: 'Security Review', pattern: 'audit|security|injection|secret|leak' },
  { subject: 'SQL & Databases', pattern: 'sql|postgres|query|index|database' },
  { subject: 'API Integration', pattern: 'integrate|webhook|api|endpoint' },
  { subject: 'Frontend / UI', pattern: 'react|ui|frontend|component|toggle' },
  { subject: 'Incident Response', pattern: 'incident|timeline|outage|logs' },
];
