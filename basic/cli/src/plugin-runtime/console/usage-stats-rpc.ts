import { PluginConsoleRpcError, type PluginConsoleRpcInput, type PluginConsoleRpcJson, type PluginConsoleRpcStatus } from '@zhin.js/plugin-runtime';
import { DAY_MS, buildUsageStats, type UsageBucket, type UsageStats } from '../../usage/aggregate.js';

/**
 * `plugin.root.usage-stats`（`control:read`）：只读的 token 用量统计，给 Console 图表用。
 * 数据来自 `data/agent-traces/*.jsonl`（与 `zhin usage report` 共用同一套聚合）。
 * 只返回计数、会话键与 provider / model 名，不返回任何消息文本。
 */

export const USAGE_STATS_PERMISSION = 'control:read';
export const USAGE_STATS_MAX_RANGE_MS = 31 * DAY_MS;
export const USAGE_STATS_DEFAULT_RANGE_MS = 7 * DAY_MS;
export const USAGE_STATS_CACHE_TTL_MS = 60_000;
export const USAGE_STATS_CACHE_MAX_ENTRIES = 32;
const MAX_SESSION_PATTERN = 256;

/** Trace directory of the current generation; `undefined` means no Agent is bound. */
export type UsageTraceDirSource = () => string | undefined;

function invalid(message: string): never {
  throw new PluginConsoleRpcError('invalid_input', message);
}

function optionalTimestamp(input: PluginConsoleRpcInput, key: string): number | undefined {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) invalid(`${key} 必须是毫秒时间戳`);
  return Math.trunc(value);
}

export interface ResolvedUsageStatsQuery {
  readonly since: number;
  readonly until: number;
  readonly bucket: UsageBucket;
  readonly session?: string;
}

export function resolveUsageStatsQuery(input: PluginConsoleRpcInput, now: number): ResolvedUsageStatsQuery {
  const until = optionalTimestamp(input, 'until') ?? now;
  const since = optionalTimestamp(input, 'since') ?? until - USAGE_STATS_DEFAULT_RANGE_MS;
  if (since >= until) invalid('since 必须早于 until');
  if (until - since > USAGE_STATS_MAX_RANGE_MS) invalid('时间范围最多 31 天');
  const rawBucket = input.bucket;
  if (rawBucket !== undefined && rawBucket !== null && rawBucket !== 'hour' && rawBucket !== 'day') invalid("bucket 只能是 'hour' 或 'day'");
  const bucket: UsageBucket = rawBucket ?? (until - since > 2 * DAY_MS ? 'day' : 'hour');
  const session = input.session;
  if (session !== undefined && session !== null && session !== '') {
    if (typeof session !== 'string' || session.length > MAX_SESSION_PATTERN) invalid(`session 必须是不超过 ${MAX_SESSION_PATTERN} 字符的字符串`);
  }
  return { since, until, bucket, ...(typeof session === 'string' && session ? { session } : {}) };
}

/** Normalised cache key from the caller's own fields, so default (`until = now`) requests share an entry. */
function cacheKey(input: PluginConsoleRpcInput): string {
  const pick = (key: string) => (input[key] === null ? undefined : input[key]);
  return JSON.stringify([pick('since'), pick('until'), pick('bucket'), pick('session') || undefined]);
}

export interface UsageStatsServiceOptions {
  readonly dir: UsageTraceDirSource;
  readonly now?: () => number;
  /** Test seam. */
  readonly build?: (dir: string, query: ResolvedUsageStatsQuery) => Promise<UsageStats>;
}

/** Computes usage stats with a small in-memory result cache (60 s, 32 entries); `dispose()` drops it. */
export class UsageStatsService {
  readonly #options: UsageStatsServiceOptions;
  readonly #now: () => number;
  readonly #cache = new Map<string, { at: number; value: Promise<UsageStats> }>();

  constructor(options: UsageStatsServiceOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
  }

  async stats(input: PluginConsoleRpcInput): Promise<UsageStats> {
    const now = this.#now();
    const query = resolveUsageStatsQuery(input, now);
    const dir = this.#options.dir();
    if (!dir) throw new PluginConsoleRpcError('unavailable', '机器人还没启动 AI，暂时没有用量记录');
    const key = `${dir}\n${cacheKey(input)}`;
    const hit = this.#cache.get(key);
    if (hit && now - hit.at < USAGE_STATS_CACHE_TTL_MS) return hit.value;
    this.#cache.delete(key);
    const value = (this.#options.build ?? buildUsageStats)(dir, query);
    this.#cache.set(key, { at: now, value });
    while (this.#cache.size > USAGE_STATS_CACHE_MAX_ENTRIES) this.#cache.delete(this.#cache.keys().next().value!);
    try {
      return await value;
    } catch (error) {
      this.#cache.delete(key);
      if (error instanceof PluginConsoleRpcError) throw error;
      throw new PluginConsoleRpcError('unavailable', '暂时读不到用量记录，请稍后再试');
    }
  }

  dispose(): void {
    this.#cache.clear();
  }
}

export function usageStatsQueries(service: () => UsageStatsService): Record<string, PluginConsoleRpcStatus> {
  return {
    'usage-stats': {
      requiredPermissions: [USAGE_STATS_PERMISSION],
      handler: async (input) => (await service().stats(input)) as unknown as PluginConsoleRpcJson,
    },
  };
}
