/**
 * One upstream feed with its own cache and health bookkeeping.
 *
 * - Conditional GET: unchanged feeds answer 304 and the cached events are reused.
 * - Cooldown: after a failed round the source is skipped for a growing period
 *   (30 s, 60 s, 120 s ... capped at 10 min), or longer when the server sent a
 *   Retry-After. Other sources keep serving in the meantime.
 * - A failed round never throws past `fetchEvents`' caller contract: it rejects
 *   with a readable Error, and the cache from the last good round is kept.
 */
import type { EarthquakeSourceId } from '../config.js';
import { getTextWithRetry, HttpRequestError, type ConditionalValidators, type HttpDependencies, type RetryPolicy } from '../http.js';
import type { SourceEarthquake } from '../types.js';

export const SOURCE_COOLDOWN_BASE_MS = 30_000;
export const SOURCE_COOLDOWN_MAX_MS = 10 * 60_000;
/** Longest Retry-After we will honour as a cooldown, to recover from bogus headers. */
export const SOURCE_RETRY_AFTER_CAP_MS = 60 * 60_000;

export interface FeedSourceOptions {
  readonly id: EarthquakeSourceId;
  readonly label: string;
  readonly url: string;
  readonly parse: (body: string) => SourceEarthquake[];
  readonly policy: RetryPolicy;
  readonly deps?: HttpDependencies;
}

export interface FeedSourceHealth {
  readonly id: EarthquakeSourceId;
  readonly label: string;
  readonly consecutiveFailures: number;
  /** Epoch ms until which the source is skipped; 0 when healthy. */
  readonly coolingDownUntil: number;
  readonly lastError?: string;
  readonly lastSuccessAt?: number;
}

export class FeedSource {
  readonly id: EarthquakeSourceId;
  readonly label: string;
  readonly #options: FeedSourceOptions;
  readonly #now: () => number;
  #validators: ConditionalValidators = {};
  #cachedEvents: SourceEarthquake[] | undefined;
  #consecutiveFailures = 0;
  #coolingDownUntil = 0;
  #lastError: string | undefined;
  #lastSuccessAt: number | undefined;

  constructor(options: FeedSourceOptions) {
    this.id = options.id;
    this.label = options.label;
    this.#options = options;
    this.#now = options.deps?.now ?? Date.now;
  }

  isCoolingDown(): boolean {
    return this.#now() < this.#coolingDownUntil;
  }

  health(): FeedSourceHealth {
    return {
      id: this.id,
      label: this.label,
      consecutiveFailures: this.#consecutiveFailures,
      coolingDownUntil: this.isCoolingDown() ? this.#coolingDownUntil : 0,
      lastError: this.#lastError,
      lastSuccessAt: this.#lastSuccessAt,
    };
  }

  /** Events from the last good round, if any; used as a stale fallback. */
  cachedEvents(): readonly SourceEarthquake[] | undefined {
    return this.#cachedEvents;
  }

  async fetchEvents(): Promise<SourceEarthquake[]> {
    try {
      const events = await this.#fetchOnce();
      this.#recordSuccess();
      return events;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.#recordFailure(error, message);
      throw new Error(`${this.label}：${message}`, { cause: error });
    }
  }

  async #fetchOnce(): Promise<SourceEarthquake[]> {
    const hasCache = this.#cachedEvents !== undefined;
    const result = await getTextWithRetry(this.#options.url, this.#options.policy, {
      validators: hasCache ? this.#validators : undefined,
      deps: this.#options.deps,
    });
    if (result.notModified && this.#cachedEvents) {
      return this.#cachedEvents;
    }
    // Parse before touching the cache so a malformed body keeps the last good data.
    const events = this.#options.parse(result.body);
    this.#cachedEvents = events;
    this.#validators = result.validators;
    return events;
  }

  #recordSuccess(): void {
    this.#consecutiveFailures = 0;
    this.#coolingDownUntil = 0;
    this.#lastError = undefined;
    this.#lastSuccessAt = this.#now();
  }

  #recordFailure(error: unknown, message: string): void {
    this.#consecutiveFailures += 1;
    this.#lastError = message;
    const exponent = Math.min(this.#consecutiveFailures - 1, 10);
    let cooldown = Math.min(SOURCE_COOLDOWN_MAX_MS, SOURCE_COOLDOWN_BASE_MS * 2 ** exponent);
    const cause = error instanceof HttpRequestError ? error : undefined;
    if (cause?.retryAfterMs !== undefined) {
      cooldown = Math.max(cooldown, Math.min(cause.retryAfterMs, SOURCE_RETRY_AFTER_CAP_MS));
    }
    this.#coolingDownUntil = this.#now() + cooldown;
  }
}
