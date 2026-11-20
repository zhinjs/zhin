/**
 * Waiting and retry primitives shared by AI providers, adapters and plugins (#1250 b80): one
 * abortable `sleep`, one `Retry-After` parser and one exponential backoff. Each caller keeps its own
 * policy (attempt budget, default delays, how a long `Retry-After` is treated).
 */

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('This operation was aborted', 'AbortError');
}

/**
 * Resolves after `ms` milliseconds (immediately for `ms <= 0`). With a `signal`, an abort before or
 * during the wait clears the timer and rejects with `signal.reason` (an `AbortError` `DOMException`
 * unless the abort gave another reason). Callers that treat an abort as "stop waiting" catch it.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortReason(signal));
  if (!(ms > 0)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      if (signal) reject(abortReason(signal));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

const DELTA_SECONDS = /^\+?(?:\d+(?:\.\d*)?|\.\d+)$/u;

/**
 * Parses an HTTP `Retry-After` value into milliseconds: delta-seconds (`120`; fractional `1.5`,
 * `.5`, `5.` and a leading `+` accepted) or an HTTP date (a date in the past is `0`). Absent, empty,
 * negative or otherwise malformed values (`-5`, `1e3`, `0x10`, `soon`) are `undefined`.
 */
export function parseRetryAfterMs(value: string | null | undefined, now: number = Date.now()): number | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (DELTA_SECONDS.test(trimmed)) {
    const ms = Math.round(Number(trimmed) * 1_000);
    return Number.isSafeInteger(ms) ? ms : undefined;
  }
  // An HTTP date always names its day / month; digits-only or signed values are not dates.
  if (!/[a-z]/iu.test(trimmed) || /^[+-]/u.test(trimmed)) return undefined;
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - now);
}

export interface BackoffPolicy {
  /** First step in milliseconds; doubles with every retry. */
  readonly baseDelayMs: number;
  /** Ceiling for one step, applied before the jitter. */
  readonly maxDelayMs: number;
  /**
   * `'equal'` (default): half the step is fixed, half random — `[step / 2, step]`.
   * A number `r` in `[0, 1]`: the step scaled by a random factor in `[1 - r, 1 + r]`. `0`: no jitter.
   */
  readonly jitter?: 'equal' | number;
}

/**
 * Exponential backoff for the `retryIndex`-th retry (0 = the first): `min(maxDelayMs, baseDelayMs × 2^retryIndex)`
 * with the policy's jitter, rounded to whole milliseconds. A server `Retry-After` is the caller's
 * decision and never part of this delay.
 */
export function computeBackoffDelay(retryIndex: number, policy: BackoffPolicy, random: () => number = Math.random): number {
  const step = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** Math.max(0, retryIndex));
  const jitter = policy.jitter ?? 'equal';
  if (jitter === 'equal') return Math.round(step / 2 + random() * (step / 2));
  const spread = Math.min(1, Math.max(0, jitter));
  return Math.round(step * (1 - spread + random() * 2 * spread));
}
