/**
 * Client-side rate limiting for the nightly real-model tier. CI runs Gemini on the
 * free tier (15 requests per minute per project, plus a requests-per-day quota), so
 * every real request goes through one {@link RateLimitedCompletionPort}:
 *
 * - **Serialized:** one request (with its retries) in flight at a time, in call order.
 * - **Paced:** at least `minIntervalMs` (default 4 s, i.e. 15 RPM) between the starts
 *   of two requests, retries and multi-turn / tool-call steps included.
 * - **429 backoff:** 2 s, 4 s, 8 s, then give up. A longer `retryDelay` (Google
 *   RetryInfo) or `Retry-After` wins over the schedule.
 * - **Daily quota:** a per-day 429 (`PerDay` / RPD in the quota id or violations) is
 *   never retried. The port remembers it, every later call fails at once, and the
 *   runner fails the whole run with that message.
 * - **503 UNAVAILABLE** (model overloaded): retried once after 8–15 s (jittered), or
 *   after `Retry-After` / RetryInfo when longer. Still 503 → {@link ProviderUnavailableError};
 *   the runner records that run as `provider-unavailable`, not as a model failure.
 *
 * Retries are real requests: they go through the pacer and the budget port behind
 * this one, so they count against `NIGHTLY_MAX_REQUESTS` and can never exceed it.
 *
 * Eval-only: production keeps the provider-resilience defaults in `@zhin.js/ai`.
 */
import { classifyProviderError, type AssistantMessage, type Context, type LlmCompletionPort, type Model, type StreamOptions } from '@zhin.js/ai';
import { positiveInt } from './budget.js';

export interface RateLimitPolicy {
  /** Minimum time between the starts of two real requests. */
  readonly minIntervalMs: number;
  /** Waits before each retry of a per-minute 429; its length is the retry count. */
  readonly backoffMs: readonly number[];
  /** Jittered wait range `[min, max]` before the single retry of a 503 UNAVAILABLE. */
  readonly unavailableBackoffMs?: readonly [number, number];
}

/** Gemini free tier: 15 RPM → one request every 4 s; 429 backoff 2/4/8 s. */
export const FREE_TIER_RATE_LIMIT: Readonly<RateLimitPolicy> = Object.freeze({
  minIntervalMs: 4_000,
  backoffMs: Object.freeze([2_000, 4_000, 8_000]),
  unavailableBackoffMs: Object.freeze([8_000, 15_000] as const),
});

/** `NIGHTLY_MIN_REQUEST_INTERVAL_MS` overrides the spacing (e.g. for a paid-tier key). */
export function resolveRateLimitPolicy(env: Readonly<Record<string, string | undefined>>): RateLimitPolicy {
  return {
    minIntervalMs: positiveInt(env.NIGHTLY_MIN_REQUEST_INTERVAL_MS, FREE_TIER_RATE_LIMIT.minIntervalMs),
    backoffMs: FREE_TIER_RATE_LIMIT.backoffMs,
    unavailableBackoffMs: FREE_TIER_RATE_LIMIT.unavailableBackoffMs,
  };
}

export interface RateLimitClock {
  now(): number;
  sleep(ms: number): Promise<void>;
  /** Uniform [0, 1) for backoff jitter; `Math.random` by default. */
  random?(): number;
}

const realClock: RateLimitClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random: () => Math.random(),
};

/** Hands out request slots one at a time, at least `minIntervalMs` apart. */
export class RequestPacer {
  #nextAt = Number.NEGATIVE_INFINITY;
  #chain: Promise<void> = Promise.resolve();

  constructor(private readonly minIntervalMs: number, private readonly clock: RateLimitClock = realClock) {}

  acquire(): Promise<void> {
    const slot = this.#chain.then(async () => {
      const wait = this.#nextAt - this.clock.now();
      if (wait > 0) await this.clock.sleep(wait);
      this.#nextAt = this.clock.now() + this.minIntervalMs;
    });
    this.#chain = slot.catch(() => undefined);
    return slot;
  }
}

export class DailyQuotaExhaustedError extends Error {
  constructor(readonly model: string, cause: unknown) {
    super(
      `Gemini free-tier daily request quota (RPD) is exhausted for ${model}: the API answered 429 with a per-day quota. `
      + 'It resets at midnight Pacific time. The nightly run fails instead of retrying or skipping.',
      { cause },
    );
    this.name = 'DailyQuotaExhaustedError';
  }
}

export class RateLimitGiveUpError extends Error {
  constructor(readonly model: string, readonly retries: number, readonly delaysMs: readonly number[], cause: unknown) {
    super(`rate limited (429) on ${model}; gave up after ${retries} retries (waited ${delaysMs.join('/')} ms)`, { cause });
    this.name = 'RateLimitGiveUpError';
  }
}

/** Still 503 UNAVAILABLE after the retry: an infrastructure problem, not a model failure. */
export class ProviderUnavailableError extends Error {
  readonly providerUnavailable = true;
  constructor(readonly model: string, readonly attempts: number, cause: unknown) {
    super(`provider-unavailable: ${model} answered 503 UNAVAILABLE ${attempts} times (model overloaded)`, { cause });
    this.name = 'ProviderUnavailableError';
  }
}

export function isProviderUnavailable(error: unknown): error is ProviderUnavailableError {
  return error instanceof ProviderUnavailableError
    || (!!error && typeof error === 'object' && (error as { providerUnavailable?: unknown }).providerUnavailable === true);
}

export type RateLimitSignal =
  | { readonly kind: 'daily' }
  | { readonly kind: 'per-minute'; readonly retryAfterMs?: number }
  | { readonly kind: 'unavailable'; readonly retryAfterMs?: number };

const DAILY_TEXT = /PerDay|\bRPD\b|requests per day/i;

function rawText(error: unknown): string {
  if (!error || typeof error !== 'object') return String(error ?? '');
  const rec = error as { message?: unknown; responseBody?: unknown };
  return [rec.message, rec.responseBody].filter((part) => typeof part === 'string').join('\n');
}

/** A 429 (daily or per-minute) or a 503 UNAVAILABLE? Anything else is not retried here. */
export function rateLimitSignal(error: unknown): RateLimitSignal | undefined {
  const classified = classifyProviderError(error);
  if (classified.kind === 'quota_exhausted') return { kind: 'daily' };
  if (classified.kind === 'server' && (classified.status === 503 || (classified.status === undefined && /\bUNAVAILABLE\b/.test(rawText(error))))) {
    return { kind: 'unavailable', ...(classified.retryAfterMs !== undefined ? { retryAfterMs: classified.retryAfterMs } : {}) };
  }
  if (classified.kind !== 'rate_limit') return undefined;
  if (DAILY_TEXT.test(rawText(error))) return { kind: 'daily' };
  return { kind: 'per-minute', ...(classified.retryAfterMs !== undefined ? { retryAfterMs: classified.retryAfterMs } : {}) };
}

export type RateLimitEvent =
  | { readonly type: 'request'; readonly model: string; readonly attempt: number; readonly at: number }
  | { readonly type: 'backoff'; readonly model: string; readonly retry: number; readonly delayMs: number }
  | { readonly type: 'give_up'; readonly model: string; readonly retries: number }
  | { readonly type: 'unavailable_retry'; readonly model: string; readonly delayMs: number }
  | { readonly type: 'unavailable'; readonly model: string; readonly attempts: number }
  | { readonly type: 'daily_quota'; readonly model: string };

export interface RateLimitStats {
  /** Real requests sent, retries included. */
  readonly requests: number;
  readonly retries: number;
  readonly gaveUp: number;
  /** 503 UNAVAILABLE answers seen, and requests that stayed 503 after their retry. */
  readonly unavailable503: number;
  readonly providerUnavailable: number;
}

type UsagePort = LlmCompletionPort & { usage?(): { requests: number; totalTokens: number } };

export class RateLimitedCompletionPort implements LlmCompletionPort {
  readonly #pacer: RequestPacer;
  readonly #clock: RateLimitClock;
  #queue: Promise<unknown> = Promise.resolve();
  #fatal: DailyQuotaExhaustedError | undefined;
  #stats = { requests: 0, retries: 0, gaveUp: 0, unavailable503: 0, providerUnavailable: 0 };

  constructor(
    private readonly base: UsagePort,
    readonly policy: RateLimitPolicy = FREE_TIER_RATE_LIMIT,
    private readonly options: { readonly clock?: RateLimitClock; readonly onEvent?: (event: RateLimitEvent) => void } = {},
  ) {
    this.#clock = options.clock ?? realClock;
    this.#pacer = new RequestPacer(policy.minIntervalMs, this.#clock);
  }

  /** The daily-quota error once one was seen; the run must fail with it. */
  fatalError(): Error | undefined {
    return this.#fatal;
  }

  stats(): RateLimitStats {
    return { ...this.#stats };
  }

  /** The wrapped port's usage (the budget), when it has one. */
  usage(): { requests: number; totalTokens: number } {
    return this.base.usage?.() ?? { requests: this.#stats.requests, totalTokens: 0 };
  }

  complete(model: Model, context: Context, options?: StreamOptions): Promise<AssistantMessage> {
    return this.#serialized(() => this.#withRetries(model, (opts) => this.base.complete(model, context, opts), options));
  }

  completeSimple(model: Model, context: Context, options?: StreamOptions): Promise<AssistantMessage> {
    return this.#serialized(() => this.#withRetries(model, (opts) => this.base.completeSimple(model, context, opts), options));
  }

  #serialized<T>(task: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(task, task);
    this.#queue = run.catch(() => undefined);
    return run;
  }

  async #withRetries(
    model: Model,
    call: (options: StreamOptions) => Promise<AssistantMessage>,
    options: StreamOptions | undefined,
  ): Promise<AssistantMessage> {
    // The SDK's own retries would bypass the pacer; this port owns retrying.
    const opts: StreamOptions = { ...options, maxRetries: 0 };
    const delays: number[] = [];
    let rateLimitRetries = 0;
    let unavailable = 0;
    for (let attempt = 0; ; attempt++) {
      if (this.#fatal) throw this.#fatal;
      await this.#pacer.acquire();
      this.#stats.requests += 1;
      this.options.onEvent?.({ type: 'request', model: model.id, attempt, at: this.#clock.now() });
      try {
        return await call(opts);
      } catch (error) {
        const signal = rateLimitSignal(error);
        if (!signal) throw error;
        if (signal.kind === 'daily') {
          this.#fatal = new DailyQuotaExhaustedError(model.id, error);
          this.options.onEvent?.({ type: 'daily_quota', model: model.id });
          throw this.#fatal;
        }
        if (signal.kind === 'unavailable') {
          this.#stats.unavailable503 += 1;
          unavailable += 1;
          if (unavailable > 1) {
            this.#stats.providerUnavailable += 1;
            this.options.onEvent?.({ type: 'unavailable', model: model.id, attempts: unavailable });
            throw new ProviderUnavailableError(model.id, unavailable, error);
          }
          const [min, max] = this.policy.unavailableBackoffMs ?? [8_000, 15_000];
          const jitter = Math.round(min + (max - min) * (this.#clock.random?.() ?? Math.random()));
          const delayMs = Math.max(jitter, signal.retryAfterMs ?? 0);
          this.#stats.retries += 1;
          this.options.onEvent?.({ type: 'unavailable_retry', model: model.id, delayMs });
          await this.#clock.sleep(delayMs);
          continue;
        }
        if (rateLimitRetries >= this.policy.backoffMs.length) {
          this.#stats.gaveUp += 1;
          this.options.onEvent?.({ type: 'give_up', model: model.id, retries: rateLimitRetries });
          throw new RateLimitGiveUpError(model.id, rateLimitRetries, delays, error);
        }
        const delayMs = Math.max(this.policy.backoffMs[rateLimitRetries] ?? 0, signal.retryAfterMs ?? 0);
        delays.push(delayMs);
        rateLimitRetries += 1;
        this.#stats.retries += 1;
        this.options.onEvent?.({ type: 'backoff', model: model.id, retry: rateLimitRetries, delayMs });
        await this.#clock.sleep(delayMs);
      }
    }
  }
}
