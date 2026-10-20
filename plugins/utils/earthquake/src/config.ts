/**
 * Plugin configuration with conservative, documented defaults.
 *
 * Every field is optional. `resolveEarthquakeConfig` fills defaults and clamps
 * out-of-range numbers so a typo in `zhin.config.yml` degrades to a safe value
 * instead of hammering the public feeds or flooding a group.
 */

export const EARTHQUAKE_SOURCE_IDS = ['cenc', 'usgs'] as const;
export type EarthquakeSourceId = (typeof EARTHQUAKE_SOURCE_IDS)[number];

/** USGS summary feeds that make sense for alerts (larger feeds are wasteful). */
export const USGS_FEEDS = [
  'significant_hour',
  'significant_day',
  '4.5_hour',
  '4.5_day',
  '2.5_hour',
  '2.5_day',
  '1.0_hour',
  '1.0_day',
] as const;
export type UsgsFeed = (typeof USGS_FEEDS)[number];

export interface EarthquakeConfig {
  /** Sources in preference order. The first one wins location text when events merge. */
  readonly sources?: readonly EarthquakeSourceId[];
  /** USGS GeoJSON summary feed name. */
  readonly usgsFeed?: UsgsFeed;
  /** 6-field solar cron for the subscription poller. */
  readonly pollCron?: string;
  /** IANA time zone used to display event times. */
  readonly timezone?: string;
  /** Per-attempt HTTP timeout. */
  readonly requestTimeoutMs?: number;
  /** Retries after the first attempt for transient failures (network, 408, 425, 429, 5xx). */
  readonly maxRetries?: number;
  /** Base delay for exponential backoff with jitter. */
  readonly retryBaseDelayMs?: number;
  /** Upper bound for a single backoff or Retry-After wait inside one request. */
  readonly retryMaxDelayMs?: number;
  /** Magnitude threshold for new subscriptions that do not name one. */
  readonly defaultMinMagnitude?: number;
  /** Magnitude threshold for the `地震` query when none is given. */
  readonly queryMinMagnitude?: number;
  /** Default number of events listed by the `地震` query. */
  readonly queryLimit?: number;
  /** Events older than this are never pushed (protects against late or replayed feeds). */
  readonly maxEventAgeMinutes?: number;
  /** Messages allowed per conversation inside one push window. */
  readonly pushLimit?: number;
  /** Length of the push rate-limit window. */
  readonly pushWindowMinutes?: number;
  /** Events listed in one push message; the rest are summarised as a count. */
  readonly maxEventsPerMessage?: number;
  /** Total subscriptions across all conversations for this plugin instance. */
  readonly maxSubscriptions?: number;
}

export type ResolvedEarthquakeConfig = {
  readonly [K in keyof EarthquakeConfig]-?: NonNullable<EarthquakeConfig[K]>;
};

export const DEFAULT_EARTHQUAKE_CONFIG: ResolvedEarthquakeConfig = Object.freeze({
  sources: Object.freeze(['cenc', 'usgs'] as EarthquakeSourceId[]),
  usgsFeed: '2.5_day',
  pollCron: '0 */2 * * * *',
  timezone: 'Asia/Shanghai',
  requestTimeoutMs: 10_000,
  maxRetries: 2,
  retryBaseDelayMs: 1_000,
  retryMaxDelayMs: 30_000,
  defaultMinMagnitude: 5,
  queryMinMagnitude: 3,
  queryLimit: 5,
  maxEventAgeMinutes: 60,
  pushLimit: 3,
  pushWindowMinutes: 10,
  maxEventsPerMessage: 5,
  maxSubscriptions: 100,
});

/** Maximum regions a single subscription may name. */
export const MAX_REGIONS_PER_SUBSCRIPTION = 5;

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

function resolveSources(value: unknown): readonly EarthquakeSourceId[] {
  if (!Array.isArray(value)) {
    return DEFAULT_EARTHQUAKE_CONFIG.sources;
  }
  const known = new Set<string>(EARTHQUAKE_SOURCE_IDS);
  const unique: EarthquakeSourceId[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    if (!known.has(entry)) continue;
    if (unique.includes(entry as EarthquakeSourceId)) continue;
    unique.push(entry as EarthquakeSourceId);
  }
  if (unique.length === 0) {
    return DEFAULT_EARTHQUAKE_CONFIG.sources;
  }
  return Object.freeze(unique);
}

function resolveUsgsFeed(value: unknown): UsgsFeed {
  const known = new Set<string>(USGS_FEEDS);
  if (typeof value === 'string' && known.has(value)) {
    return value as UsgsFeed;
  }
  return DEFAULT_EARTHQUAKE_CONFIG.usgsFeed;
}

function resolveString(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

/** Throws when the configured time zone is unknown to the runtime's Intl data. */
export function assertEarthquakeTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat('zh-CN', { timeZone: timezone });
  } catch {
    throw new Error(`地震插件 timezone 无效：${timezone}（需要 IANA 时区，例如 Asia/Shanghai）`);
  }
}

export function resolveEarthquakeConfig(raw: unknown): ResolvedEarthquakeConfig {
  const input = (raw !== null && typeof raw === 'object' ? raw : {}) as EarthquakeConfig;
  const defaults = DEFAULT_EARTHQUAKE_CONFIG;
  const retryBaseDelayMs = clampNumber(input.retryBaseDelayMs, defaults.retryBaseDelayMs, 100, 10_000);
  const retryMaxDelayMs = clampNumber(input.retryMaxDelayMs, defaults.retryMaxDelayMs, 1_000, 120_000);
  return Object.freeze({
    sources: resolveSources(input.sources),
    usgsFeed: resolveUsgsFeed(input.usgsFeed),
    pollCron: resolveString(input.pollCron, defaults.pollCron),
    timezone: resolveString(input.timezone, defaults.timezone),
    requestTimeoutMs: clampNumber(input.requestTimeoutMs, defaults.requestTimeoutMs, 1_000, 60_000),
    maxRetries: Math.round(clampNumber(input.maxRetries, defaults.maxRetries, 0, 5)),
    retryBaseDelayMs,
    retryMaxDelayMs: Math.max(retryBaseDelayMs, retryMaxDelayMs),
    defaultMinMagnitude: clampNumber(input.defaultMinMagnitude, defaults.defaultMinMagnitude, 0, 10),
    queryMinMagnitude: clampNumber(input.queryMinMagnitude, defaults.queryMinMagnitude, 0, 10),
    queryLimit: Math.round(clampNumber(input.queryLimit, defaults.queryLimit, 1, 20)),
    maxEventAgeMinutes: clampNumber(input.maxEventAgeMinutes, defaults.maxEventAgeMinutes, 5, 1_440),
    pushLimit: Math.round(clampNumber(input.pushLimit, defaults.pushLimit, 1, 60)),
    pushWindowMinutes: clampNumber(input.pushWindowMinutes, defaults.pushWindowMinutes, 1, 1_440),
    maxEventsPerMessage: Math.round(clampNumber(input.maxEventsPerMessage, defaults.maxEventsPerMessage, 1, 10)),
    maxSubscriptions: Math.round(clampNumber(input.maxSubscriptions, defaults.maxSubscriptions, 1, 1_000)),
  });
}
