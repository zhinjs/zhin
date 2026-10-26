import { message } from './messages.js';
/**
 * Resilient JSON-over-HTTP for third-party, keyless public APIs.
 *
 * Every external call in this plugin goes through {@link fetchJson}:
 * - per-attempt timeout (AbortSignal), combined with the caller's signal;
 * - retry of transient failures only: network errors, timeouts, 408, 425, 429
 *   and 5xx gateway-ish statuses (500, 502, 503, 504);
 * - exponential backoff with "equal jitter" (half fixed, half random) so many
 *   bots do not retry in lock-step;
 * - `Retry-After` is honoured (seconds or HTTP-date) up to a cap; a longer
 *   server-requested wait fails fast with a clear rate-limit message instead of
 *   blocking a chat reply for minutes;
 * - response bodies are size-capped and parsed defensively; malformed JSON is
 *   reported as `malformed`, never thrown as a raw SyntaxError.
 *
 * All clocks, sleeps, randomness and fetch are injectable for tests.
 */
import { NettoolsError } from './errors.js';

export type FetchLike = (input: URL, init: RequestInit) => Promise<Response>;

export interface HttpDependencies {
  readonly fetch: FetchLike;
  readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly random: () => number;
  readonly now: () => number;
}

export interface RetryPolicy {
  /** Per-attempt timeout in ms. */
  readonly timeoutMs: number;
  /** Extra attempts after the first one. */
  readonly maxRetries: number;
  /** First backoff step in ms; doubles on every retry. */
  readonly baseDelayMs: number;
  /** Upper bound for one computed backoff step. */
  readonly maxDelayMs: number;
  /** Longest `Retry-After` we are willing to wait inside one chat request. */
  readonly maxRetryAfterMs: number;
}

export interface FetchJsonOptions {
  /** Human name of the provider, used in error messages. */
  readonly provider: string;
  readonly accept?: string;
  readonly signal?: AbortSignal;
  /** Statuses that are a valid answer rather than an error (e.g. RDAP 404). */
  readonly passStatuses?: readonly number[];
  readonly maxBodyBytes?: number;
  /** Override {@link RetryPolicy.maxRetries} for this call (e.g. when a fallback provider exists). */
  readonly maxRetries?: number;
}

export interface JsonResponse {
  readonly status: number;
  readonly body: unknown;
  readonly url: string;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = Object.freeze({
  timeoutMs: 8_000,
  maxRetries: 2,
  baseDelayMs: 500,
  maxDelayMs: 4_000,
  maxRetryAfterMs: 10_000,
});

/** 1 MiB is far above any legitimate answer from the APIs we call. */
export const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

export function defaultHttpDependencies(): HttpDependencies {
  return {
    fetch: (input, init) => fetch(input, init),
    sleep: abortableSleep,
    random: Math.random,
    now: Date.now,
  };
}

export class HttpClient {
  readonly #deps: HttpDependencies;
  readonly #policy: RetryPolicy;

  constructor(policy: RetryPolicy = DEFAULT_RETRY_POLICY, deps: HttpDependencies = defaultHttpDependencies()) {
    this.#policy = policy;
    this.#deps = deps;
  }

  get policy(): RetryPolicy {
    return this.#policy;
  }

  get dependencies(): HttpDependencies {
    return this.#deps;
  }

  /** GET a JSON document with timeout, retry, backoff and Retry-After handling. */
  async fetchJson(url: URL, options: FetchJsonOptions): Promise<JsonResponse> {
    const maxRetries = options.maxRetries ?? this.#policy.maxRetries;
    const attempts = Math.max(0, maxRetries) + 1;
    let lastError: NettoolsError | undefined;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      throwIfAborted(options.signal, options.provider);
      const outcome = await this.#attempt(url, options);
      if (outcome.kind === 'ok') {
        return outcome.response;
      }
      lastError = outcome.error;
      const isLastAttempt = attempt === attempts - 1;
      if (!outcome.retryable || isLastAttempt) {
        break;
      }
      const delay = this.#computeDelay(attempt, outcome.retryAfterMs);
      if (delay === undefined) {
        break;
      }
      await this.#deps.sleep(delay, options.signal);
    }
    throw lastError ?? new NettoolsError('network', message('requestFailed', { provider: options.provider }));
  }

  async #attempt(url: URL, options: FetchJsonOptions): Promise<AttemptOutcome> {
    const timeoutSignal = AbortSignal.timeout(this.#policy.timeoutMs);
    const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
    let response: Response;
    try {
      response = await this.#deps.fetch(url, {
        method: 'GET',
        headers: { accept: options.accept ?? 'application/json' },
        redirect: 'follow',
        signal,
      });
    } catch (error) {
      return this.#classifyTransportError(error, options, timeoutSignal);
    }

    const passStatuses = options.passStatuses ?? [];
    const statusIsAnswer = response.ok || passStatuses.includes(response.status);
    if (!statusIsAnswer) {
      await discardBody(response);
      return this.#classifyStatus(response, options.provider);
    }

    let text: string;
    try {
      text = await readLimitedText(response, options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES);
    } catch (error) {
      if (error instanceof NettoolsError) {
        return { kind: 'error', retryable: false, error };
      }
      return this.#classifyTransportError(error, options, timeoutSignal);
    }

    const body = parseJsonSafely(text);
    if (body === undefined) {
      const error = new NettoolsError('malformed', message('responseMalformed', { provider: options.provider }));
      return { kind: 'error', retryable: false, error };
    }
    const finalUrl = response.url || url.toString();
    return { kind: 'ok', response: { status: response.status, body, url: finalUrl } };
  }

  #classifyTransportError(error: unknown, options: FetchJsonOptions, timeoutSignal: AbortSignal): AttemptOutcome {
    if (options.signal?.aborted) {
      return { kind: 'error', retryable: false, error: abortedError(options.provider) };
    }
    if (timeoutSignal.aborted) {
      const seconds = Math.round(this.#policy.timeoutMs / 1000);
      const timeout = new NettoolsError('timeout', message('timeout', { provider: options.provider, seconds }), { cause: error });
      return { kind: 'error', retryable: true, error: timeout };
    }
    const detail = error instanceof Error ? error.message : String(error);
    const network = new NettoolsError('network', message('network', { provider: options.provider, detail }), { cause: error });
    return { kind: 'error', retryable: true, error: network };
  }

  #classifyStatus(response: Response, provider: string): AttemptOutcome {
    const status = response.status;
    const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'), this.#deps.now());
    if (status === 429) {
      const error = new NettoolsError('rate_limited', message('rateLimited', { provider }), {
        status,
        ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
      });
      return { kind: 'error', retryable: true, error, retryAfterMs };
    }
    const error = new NettoolsError('http', message('http', { provider, status }), { status });
    const retryable = RETRYABLE_STATUSES.has(status);
    return { kind: 'error', retryable, error, retryAfterMs };
  }

  /**
   * Backoff for retry number `attempt + 1`. Returns `undefined` when the
   * server asked us to wait longer than {@link RetryPolicy.maxRetryAfterMs}.
   */
  #computeDelay(attempt: number, retryAfterMs: number | undefined): number | undefined {
    if (retryAfterMs !== undefined) {
      if (retryAfterMs > this.#policy.maxRetryAfterMs) {
        return undefined;
      }
      return retryAfterMs;
    }
    const exponential = this.#policy.baseDelayMs * 2 ** attempt;
    const capped = Math.min(this.#policy.maxDelayMs, exponential);
    const half = capped / 2;
    return Math.round(half + this.#deps.random() * half);
  }
}

type AttemptOutcome =
  | { readonly kind: 'ok'; readonly response: JsonResponse }
  | {
      readonly kind: 'error';
      readonly retryable: boolean;
      readonly error: NettoolsError;
      readonly retryAfterMs?: number | undefined;
    };

/** Parse `Retry-After` as delta-seconds or an HTTP-date. Invalid values are ignored. */
export function parseRetryAfter(value: string | null, nowMs: number): number | undefined {
  if (value === null) {
    return undefined;
  }
  const trimmed = value.trim();
  if (/^\d+$/u.test(trimmed)) {
    return Number(trimmed) * 1000;
  }
  const dateMs = Date.parse(trimmed);
  if (Number.isNaN(dateMs)) {
    return undefined;
  }
  return Math.max(0, dateMs - nowMs);
}

function parseJsonSafely(text: string): unknown {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed === undefined ? undefined : parsed;
  } catch {
    return undefined;
  }
}

async function readLimitedText(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > maxBytes) {
    await discardBody(response);
    throw new NettoolsError('malformed', message('tooLarge'));
  }
  if (!response.body) {
    return await response.text();
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = '';
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) {
      break;
    }
    received += chunk.value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      throw new NettoolsError('malformed', message('tooLarge'));
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  text += decoder.decode();
  return text;
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Ignore: the body is irrelevant once we decided the status is an error.
  }
}

function throwIfAborted(signal: AbortSignal | undefined, provider: string): void {
  if (signal?.aborted) {
    throw abortedError(provider);
  }
}

function abortedError(provider: string): NettoolsError {
  return new NettoolsError('aborted', message('providerAborted', { provider }));
}

export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new NettoolsError('aborted', message('aborted')));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new NettoolsError('aborted', message('aborted')));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
