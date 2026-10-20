/** Plugin configuration; defaults mirror schema.json. */
export interface BilibiliConfig {
  readonly pollCron?: string;
  readonly jitterMs?: number;
  readonly requestGapMs?: number;
  readonly maxBackoffMinutes?: number;
  readonly maxPerChannel?: number;
  readonly timeout?: number;
  readonly live?: boolean;
  readonly dynamic?: boolean;
  readonly cookie?: string;
}

export type ResolvedBilibiliConfig = Required<BilibiliConfig>;

export const DEFAULT_BILIBILI_CONFIG: ResolvedBilibiliConfig = Object.freeze({
  pollCron: '0 * * * * *',
  jitterMs: 15_000,
  requestGapMs: 1_500,
  maxBackoffMinutes: 30,
  maxPerChannel: 20,
  timeout: 10_000,
  live: true,
  dynamic: true,
  cookie: '',
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function num(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function resolveBilibiliConfig(raw: unknown): ResolvedBilibiliConfig {
  const input = isRecord(raw) ? raw : {};
  const d = DEFAULT_BILIBILI_CONFIG;
  return {
    pollCron: typeof input.pollCron === 'string' && input.pollCron.trim() ? input.pollCron.trim() : d.pollCron,
    jitterMs: num(input.jitterMs, d.jitterMs, 0, 120_000),
    requestGapMs: num(input.requestGapMs, d.requestGapMs, 0, 30_000),
    maxBackoffMinutes: num(input.maxBackoffMinutes, d.maxBackoffMinutes, 1, 720),
    maxPerChannel: Math.floor(num(input.maxPerChannel, d.maxPerChannel, 1, 200)),
    timeout: num(input.timeout, d.timeout, 1_000, 60_000),
    live: typeof input.live === 'boolean' ? input.live : d.live,
    dynamic: typeof input.dynamic === 'boolean' ? input.dynamic : d.dynamic,
    cookie: typeof input.cookie === 'string' ? input.cookie.trim() : d.cookie,
  };
}
