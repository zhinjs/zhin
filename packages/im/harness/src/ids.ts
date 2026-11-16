/**
 * Engagement, mail and grant ids (#1250 b35 engagement-id-reused-across-restarts).
 *
 * Ids were a bare per-process counter (`m1`, `m2`, … / `g1`, …) that restarted with every
 * instance, so `engagement_events` mixed unrelated engagements under one id. Ids are now
 * `<prefix>-<runId>-<n>`: a run id minted once per harness (process start time in base36 plus
 * random base36 characters) and the old counter. The counter keeps ids short and ordered within
 * a run; the run id makes them unique across restarts and across processes sharing a database.
 * Ids stay opaque strings for every consumer (Console protocol, Workroom, `zhin trace`).
 */

const RUN_RANDOM_CHARS = 6;

function randomBase36(length: number): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (const byte of bytes) out += (byte % 36).toString(36);
  return out;
}

/** A new run id: base36 start time followed by random base36 characters (no `-` or `:`). */
export function createRunId(now: number = Date.now()): string {
  return `${Math.max(0, Math.floor(now)).toString(36)}${randomBase36(RUN_RANDOM_CHARS)}`;
}

/** `<prefix>-<runId>-1`, `<prefix>-<runId>-2`, … */
export function createRunScopedIdFactory(prefix: string, runId: string = createRunId()): () => string {
  let counter = 0;
  return () => `${prefix}-${runId}-${++counter}`;
}

/** True for the pre-b35 counter ids (`m17`, `g3`) that restarted with every process. */
export function isLegacyCounterId(value: unknown, prefix: 'm' | 'g'): value is string {
  return typeof value === 'string' && value.length > 1 && value[0] === prefix && /^\d+$/u.test(value.slice(1));
}
