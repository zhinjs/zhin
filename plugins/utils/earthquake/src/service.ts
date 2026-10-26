import { resolveLocale, type Locale } from 'zhin.js/i18n';
import { messages as t } from './i18n.js';
/**
 * Earthquake service: fetches every enabled source, merges reports, answers
 * queries and drives the subscription poller.
 *
 * Poller guarantees:
 * - `poll()` never throws; every failure is logged and reported in the result.
 * - Overlapping ticks are skipped (single flight), so a slow source cannot pile up work.
 * - The first successful fetch of each source is a baseline: its current events
 *   are remembered without pushing, so startup or source recovery never floods groups.
 * - Events older than `maxEventAgeMinutes` are never pushed.
 * - Each physical event is pushed at most once (it is marked seen before sending;
 *   a failed send is logged and not retried, to avoid duplicate deliveries).
 * - Pushes are rate-limited per conversation; skipped events are summarised as a
 *   count in that conversation's next allowed push.
 */
import type { EarthquakeSourceId, ResolvedEarthquakeConfig } from './config.js';
import { mergeReports, SeenEventLog } from './dedupe.js';
import { matchesFilter, type EventFilter } from './filters.js';
import { formatEventList, formatSourceWarnings } from './format.js';
import type { HttpDependencies, RetryPolicy } from './http.js';
import { SlidingWindowRateLimiter } from './rate-limit.js';
import { parseCencFeed } from './sources/cenc.js';
import { FeedSource, type FeedSourceHealth } from './sources/feed-source.js';
import { parseUsgsFeed, usgsFeedUrl } from './sources/usgs.js';
import { subscriptionKey, type EarthquakeSubscription, type SubscriptionStore } from './subscriptions.js';
import type { EarthquakeEvent, SourceEarthquake, SourceOutcome } from './types.js';

/** Reports dated further in the future than this are treated as corrupt. */
const FUTURE_TOLERANCE_MS = 10 * 60_000;

export type PushSender = (subscription: EarthquakeSubscription, content: string) => Promise<void>;

export interface ServiceLogger {
  warn(message: string): void;
  debug?(message: string): void;
}

export interface EarthquakeServiceOptions {
  readonly config: ResolvedEarthquakeConfig;
  readonly store: SubscriptionStore;
  readonly push?: PushSender;
  readonly deps?: HttpDependencies;
  readonly logger?: ServiceLogger;
  /** Replaces the default CENC/USGS sources (tests, custom mirrors). */
  readonly sources?: readonly FeedSource[];
}

export interface QueryOptions extends EventFilter {
  readonly limit: number;
  readonly hours: number;
}

export interface QueryResult {
  readonly events: readonly EarthquakeEvent[];
  /** Matching events before the limit was applied. */
  readonly total: number;
  readonly outcomes: readonly SourceOutcome[];
  /** True when every source failed and cached data from an earlier round was used. */
  readonly stale: boolean;
}

export type PollStatus = 'ok' | 'skipped' | 'failed';

export interface PollReport {
  readonly status: PollStatus;
  readonly outcomes: readonly SourceOutcome[];
  readonly newEvents: number;
  readonly pushed: number;
  readonly rateLimited: number;
  readonly failedPushes: number;
  readonly error?: string;
}

export class EarthquakeUnavailableError extends Error {
  readonly outcomes: readonly SourceOutcome[];

  constructor(outcomes: readonly SourceOutcome[]) {
    super(formatSourceWarnings(outcomes) ?? '所有地震数据源暂时不可用');
    this.name = 'EarthquakeUnavailableError';
    this.outcomes = outcomes;
  }
}

const SOURCE_LABELS: Readonly<Record<EarthquakeSourceId, string>> = {
  cenc: 'CENC 中国地震台网',
  usgs: 'USGS',
};

export function createDefaultSources(config: ResolvedEarthquakeConfig, deps?: HttpDependencies): FeedSource[] {
  const policy: RetryPolicy = {
    timeoutMs: config.requestTimeoutMs,
    maxRetries: config.maxRetries,
    baseDelayMs: config.retryBaseDelayMs,
    maxDelayMs: config.retryMaxDelayMs,
  };
  return config.sources.map((id) => {
    if (id === 'cenc') {
      return new FeedSource({ id, label: SOURCE_LABELS.cenc, urls: config.cencUrls, parse: parseCencFeed, policy, deps });
    }
    return new FeedSource({ id, label: SOURCE_LABELS.usgs, urls: [usgsFeedUrl(config.usgsFeed)], parse: parseUsgsFeed, policy, deps });
  });
}

function emptyReport(status: PollStatus, outcomes: readonly SourceOutcome[], error?: string): PollReport {
  return { status, outcomes, newEvents: 0, pushed: 0, rateLimited: 0, failedPushes: 0, error };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class EarthquakeService {
  readonly config: ResolvedEarthquakeConfig;
  readonly store: SubscriptionStore;
  readonly #sources: readonly FeedSource[];
  readonly #push?: PushSender;
  readonly #logger?: ServiceLogger;
  readonly #now: () => number;
  readonly #seen = new SeenEventLog();
  readonly #baselinedSources = new Set<EarthquakeSourceId>();
  readonly #limiter: SlidingWindowRateLimiter;
  readonly #rateLimitedCounts = new Map<string, number>();
  #polling = false;
  #stopped = false;

  constructor(options: EarthquakeServiceOptions) {
    this.config = options.config;
    this.store = options.store;
    this.#push = options.push;
    this.#logger = options.logger;
    this.#now = options.deps?.now ?? Date.now;
    this.#sources = options.sources ?? createDefaultSources(options.config, options.deps);
    this.#limiter = new SlidingWindowRateLimiter({
      limit: options.config.pushLimit,
      windowMs: options.config.pushWindowMinutes * 60_000,
      now: this.#now,
    });
  }

  get canPush(): boolean {
    return this.#push !== undefined;
  }

  health(): readonly FeedSourceHealth[] {
    return this.#sources.map((source) => source.health());
  }

  /** Stops future polls; an in-flight poll finishes its current step. */
  stop(): void {
    this.#stopped = true;
  }

  async #fetchAll(): Promise<{ readonly reports: Map<EarthquakeSourceId, SourceEarthquake[]>; readonly outcomes: SourceOutcome[] }> {
    const reports = new Map<EarthquakeSourceId, SourceEarthquake[]>();
    const settled = await Promise.all(this.#sources.map(async (source): Promise<SourceOutcome> => {
      if (source.isCoolingDown()) {
        return { source: source.id, ok: false, skipped: true, eventCount: 0 };
      }
      try {
        const events = await source.fetchEvents();
        reports.set(source.id, events);
        return { source: source.id, ok: true, eventCount: events.length };
      } catch (error) {
        return { source: source.id, ok: false, error: errorMessage(error), eventCount: 0 };
      }
    }));
    return { reports, outcomes: settled };
  }

  #withinWindow(reports: readonly SourceEarthquake[], windowMs: number): SourceEarthquake[] {
    const now = this.#now();
    const oldest = now - windowMs;
    const newest = now + FUTURE_TOLERANCE_MS;
    return reports.filter((report) => report.time >= oldest && report.time <= newest);
  }

  /** Recent events matching the filter, newest first. Falls back to cached data when every source fails. */
  async queryRecent(options: QueryOptions): Promise<QueryResult> {
    const { reports, outcomes } = await this.#fetchAll();
    let stale = false;
    let collected = [...reports.values()].flat();
    if (reports.size === 0) {
      const cached = this.#sources.flatMap((source) => source.cachedEvents() ?? []);
      if (cached.length === 0) {
        throw new EarthquakeUnavailableError(outcomes);
      }
      stale = true;
      collected = cached;
    }
    const windowed = this.#withinWindow(collected, options.hours * 60 * 60_000);
    const merged = mergeReports(windowed, this.config.sources);
    const matching = merged.filter((event) => matchesFilter(event, options));
    return {
      events: matching.slice(0, options.limit),
      total: matching.length,
      outcomes,
      stale,
    };
  }

  /** One poller tick. Never throws. */
  async poll(): Promise<PollReport> {
    if (this.#stopped) return emptyReport('skipped', []);
    if (this.#polling) return emptyReport('skipped', []);
    this.#polling = true;
    try {
      return await this.#pollOnce();
    } catch (error) {
      const message = errorMessage(error);
      this.#logger?.warn(`[earthquake] poll failed: ${message}`);
      return emptyReport('failed', [], message);
    } finally {
      this.#polling = false;
    }
  }

  async #pollOnce(): Promise<PollReport> {
    const { reports, outcomes } = await this.#fetchAll();
    for (const outcome of outcomes) {
      if (!outcome.ok && !outcome.skipped) {
        this.#logger?.warn(`[earthquake] source failed: ${outcome.error ?? outcome.source}`);
      }
    }
    if (reports.size === 0) {
      return emptyReport('failed', outcomes, '所有数据源本轮均不可用');
    }

    const windowMs = this.config.maxEventAgeMinutes * 60_000;
    const windowed = new Map<EarthquakeSourceId, SourceEarthquake[]>();
    for (const [source, sourceReports] of reports) {
      windowed.set(source, this.#withinWindow(sourceReports, windowMs));
    }

    // Baseline: remember what a source shows on its first good round, push nothing from it.
    for (const [source, sourceReports] of windowed) {
      if (this.#baselinedSources.has(source)) continue;
      for (const report of sourceReports) {
        this.#seen.add({ primary: report, reports: [report] });
      }
      this.#baselinedSources.add(source);
    }

    const merged = mergeReports([...windowed.values()].flat(), this.config.sources);
    const fresh = merged.filter((event) => !this.#seen.has(event));
    // Merged events may carry reports that were never seen; record them all.
    for (const event of merged) {
      this.#seen.add(event);
    }
    this.#seen.prune(this.#now());

    if (fresh.length === 0 || !this.#push || this.#stopped) {
      return { ...emptyReport('ok', outcomes), newEvents: fresh.length };
    }

    let subscriptions: EarthquakeSubscription[];
    try {
      subscriptions = await this.store.list();
    } catch (error) {
      const message = errorMessage(error);
      this.#logger?.warn(`[earthquake] cannot load subscriptions: ${message}`);
      return { ...emptyReport('failed', outcomes, message), newEvents: fresh.length };
    }

    let pushed = 0;
    let rateLimited = 0;
    let failedPushes = 0;
    for (const subscription of subscriptions) {
      const matching = fresh.filter((event) => matchesFilter(event, subscription));
      if (matching.length === 0) continue;
      const key = subscriptionKey(subscription);
      if (!this.#limiter.tryAcquire(key)) {
        rateLimited += matching.length;
        this.#rateLimitedCounts.set(key, (this.#rateLimitedCounts.get(key) ?? 0) + matching.length);
        continue;
      }
      const content = this.#formatPush(matching, this.#rateLimitedCounts.get(key) ?? 0, resolveLocale(subscription.locale));
      this.#rateLimitedCounts.delete(key);
      try {
        await this.#push(subscription, content);
        pushed += 1;
      } catch (error) {
        failedPushes += 1;
        this.#logger?.warn(`[earthquake] push to ${subscription.adapter}/${subscription.conversationKind}/${subscription.conversationId} failed: ${errorMessage(error)}`);
      }
    }
    return { status: 'ok', outcomes, newEvents: fresh.length, pushed, rateLimited, failedPushes };
  }

  #formatPush(events: readonly EarthquakeEvent[], previouslyRateLimited: number, locale: Locale): string {
    const limit = this.config.maxEventsPerMessage;
    const shown = events.slice(0, limit);
    const title = events.length === 1 ? t(locale, 'alert') : t(locale, 'alerts', { count: events.length });
    const footer = previouslyRateLimited > 0
      ? t(locale, 'rateLimited', { count: previouslyRateLimited })
      : undefined;
    return formatEventList({
      title,
      locale,
      events: shown,
      timezone: this.config.timezone,
      hiddenCount: events.length - shown.length,
      footer: [footer],
    });
  }
}
