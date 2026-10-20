/**
 * Resilient HTTP GET for public, key-less earthquake feeds.
 *
 * - Every attempt has its own timeout (AbortSignal.timeout).
 * - Transient failures are retried with exponential backoff and jitter:
 *   network errors, timeouts, 408, 425, 429 and 5xx.
 * - `Retry-After` (seconds or HTTP date) is honoured, capped by `maxDelayMs`.
 *   A server asking for a longer pause stops the retry loop and surfaces
 *   `retryAfterMs` so the caller can cool the source down instead of waiting.
 * - Other 4xx responses fail immediately: retrying will not fix them.
 * - Conditional requests (ETag / Last-Modified) avoid re-downloading unchanged feeds.
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export type SleepLike = (ms: number) => Promise<void>;

export interface RetryPolicy {
  /** Per-attempt timeout in milliseconds. */
  readonly timeoutMs: number;
  /** Retries after the first attempt. */
  readonly maxRetries: number;
  /** First backoff step in milliseconds; doubles each retry. */
  readonly baseDelayMs: number;
  /** Ceiling for one backoff step and for honouring Retry-After. */
  readonly maxDelayMs: number;
}

export interface HttpDependencies {
  readonly fetch?: FetchLike;
  readonly sleep?: SleepLike;
  /** Returns a number in [0, 1); injected for deterministic tests. */
  readonly random?: () => number;
  /** Wall clock used to evaluate HTTP-date Retry-After values. */
  readonly now?: () => number;
}

export class HttpRequestError extends Error {
  readonly status?: number;
  readonly retryable: boolean;
  /** Server-requested pause that exceeded the in-request retry budget. */
  readonly retryAfterMs?: number;

  constructor(message: string, options: {
    status?: number;
    retryable: boolean;
    retryAfterMs?: number;
    cause?: unknown;
  }) {
    super(message, { cause: options.cause });
    this.name = 'HttpRequestError';
    this.status = options.status;
    this.retryable = options.retryable;
    this.retryAfterMs = options.retryAfterMs;
  }
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUS.has(status);
}

/** Parses `Retry-After` as delta-seconds or an HTTP date. Returns undefined when absent or invalid. */
export function parseRetryAfter(value: string | null, now: number): number | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^\d+$/u.test(trimmed)) {
    return Number(trimmed) * 1_000;
  }
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - now);
}

/**
 * Exponential backoff with "equal jitter": half of the step is fixed, half is random.
 * This keeps a minimum spacing between retries while still spreading clients apart.
 */
export function computeBackoffDelay(retryIndex: number, policy: RetryPolicy, random: () => number): number {
  const exponential = policy.baseDelayMs * 2 ** retryIndex;
  const step = Math.min(policy.maxDelayMs, exponential);
  const half = step / 2;
  return Math.round(half + random() * half);
}

const defaultSleep: SleepLike = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

function describeFailure(error: unknown, timeoutMs: number): string {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return `请求超时（${timeoutMs}ms）`;
    }
    return `网络错误：${error.message}`;
  }
  return `网络错误：${String(error)}`;
}

export interface ConditionalValidators {
  readonly etag?: string;
  readonly lastModified?: string;
}

export interface GetResult {
  /** 304 Not Modified: the caller should reuse its cached body. */
  readonly notModified: boolean;
  readonly body: string;
  readonly validators: ConditionalValidators;
  /** Attempts used, including the successful one. */
  readonly attempts: number;
}

/** GET a URL as text with timeout, retries and optional conditional validators. */
export async function getTextWithRetry(
  url: string,
  policy: RetryPolicy,
  options: {
    readonly headers?: Readonly<Record<string, string>>;
    readonly validators?: ConditionalValidators;
    readonly deps?: HttpDependencies;
  } = {},
): Promise<GetResult> {
  const fetchImpl = options.deps?.fetch ?? ((input, init) => fetch(input, init));
  const sleep = options.deps?.sleep ?? defaultSleep;
  const random = options.deps?.random ?? Math.random;
  const now = options.deps?.now ?? Date.now;

  const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };
  if (options.validators?.etag) {
    headers['If-None-Match'] = options.validators.etag;
  }
  if (options.validators?.lastModified) {
    headers['If-Modified-Since'] = options.validators.lastModified;
  }

  let lastError: HttpRequestError | undefined;
  for (let attempt = 0; attempt <= policy.maxRetries; attempt += 1) {
    if (attempt > 0) {
      const retryAfter = lastError?.retryAfterMs;
      const backoff = computeBackoffDelay(attempt - 1, policy, random);
      const delay = retryAfter === undefined ? backoff : Math.max(backoff, retryAfter);
      await sleep(delay);
    }
    const attemptNumber = attempt + 1;
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        headers,
        redirect: 'follow',
        signal: AbortSignal.timeout(policy.timeoutMs),
      });
    } catch (error) {
      lastError = new HttpRequestError(describeFailure(error, policy.timeoutMs), { retryable: true, cause: error });
      continue;
    }

    if (response.status === 304) {
      return { notModified: true, body: '', validators: options.validators ?? {}, attempts: attemptNumber };
    }

    if (response.ok) {
      let body: string;
      try {
        body = await response.text();
      } catch (error) {
        // A body cut off mid-stream (or a timeout while reading) is transient.
        lastError = new HttpRequestError(describeFailure(error, policy.timeoutMs), { retryable: true, cause: error });
        continue;
      }
      const validators: ConditionalValidators = {
        etag: response.headers.get('etag') ?? undefined,
        lastModified: response.headers.get('last-modified') ?? undefined,
      };
      return { notModified: false, body, validators, attempts: attemptNumber };
    }

    const retryable = isRetryableStatus(response.status);
    const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'), now());
    // Release the connection; the error body is not needed.
    await response.body?.cancel().catch(() => undefined);
    const message = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
    if (!retryable) {
      throw new HttpRequestError(message, { status: response.status, retryable: false });
    }
    if (retryAfterMs !== undefined && retryAfterMs > policy.maxDelayMs) {
      // The server wants a longer pause than one request may wait: stop now and
      // let the caller put the whole source on cooldown.
      throw new HttpRequestError(message, { status: response.status, retryable: true, retryAfterMs });
    }
    lastError = new HttpRequestError(message, { status: response.status, retryable: true, retryAfterMs });
  }

  throw lastError ?? new HttpRequestError('请求失败', { retryable: true });
}
