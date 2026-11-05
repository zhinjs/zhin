export interface VenueSendLimiterOptions {
  readonly minIntervalMs?: number;
  readonly maxBurst?: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export type VenueSendLimiterKey =
  | string
  | {
      readonly venueId?: string;
      readonly endpointId: string;
    };

export interface VenueSendLimiter {
  acquire(key: VenueSendLimiterKey): Promise<number>;
  withLimit<T>(key: VenueSendLimiterKey, fn: () => Promise<T> | T): Promise<T>;
  schedule<T>(key: VenueSendLimiterKey, fn: () => Promise<T> | T): Promise<T>;
  reset(key?: VenueSendLimiterKey): void;
}

interface BucketState {
  tokens: number;
  lastRefillAt: number;
  nextAvailableAt: number;
}

function normalizeLimiterKey(key: VenueSendLimiterKey): string {
  if (typeof key === 'string') return key;
  return `${key.venueId ?? '*'}:${key.endpointId}`;
}

export function createVenueSendLimiter(options: VenueSendLimiterOptions = {}): VenueSendLimiter {
  const minIntervalMs = Math.max(0, options.minIntervalMs ?? 1000);
  const maxBurst = Math.max(1, Math.floor(options.maxBurst ?? 1));
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep
    ?? ((ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      }));

  const buckets = new Map<string, BucketState>();

  const reserveWaitMs = (rawKey: VenueSendLimiterKey): number => {
    if (minIntervalMs <= 0) return 0;
    const key = normalizeLimiterKey(rawKey);
    const current = now();
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        tokens: maxBurst,
        lastRefillAt: current,
        nextAvailableAt: current,
      };
      buckets.set(key, bucket);
    } else if (current > bucket.lastRefillAt) {
      const elapsed = current - bucket.lastRefillAt;
      const replenished = elapsed / minIntervalMs;
      bucket.tokens = Math.min(maxBurst, bucket.tokens + replenished);
      bucket.lastRefillAt = current;
    }

    if (bucket.tokens >= 1 && current >= bucket.nextAvailableAt) {
      bucket.tokens -= 1;
      if (bucket.tokens < 1) {
        bucket.nextAvailableAt = current + Math.ceil((1 - bucket.tokens) * minIntervalMs);
      }
      return 0;
    }

    const scheduledAt = Math.max(current, bucket.nextAvailableAt);
    const waitMs = scheduledAt - current;
    bucket.tokens = 0;
    bucket.lastRefillAt = scheduledAt;
    bucket.nextAvailableAt = scheduledAt + minIntervalMs;
    return waitMs;
  };

  const acquire = async (key: VenueSendLimiterKey): Promise<number> => {
    const waitMs = reserveWaitMs(key);
    if (waitMs > 0) {
      await sleep(waitMs);
    }
    return waitMs;
  };

  const withLimit = async <T>(key: VenueSendLimiterKey, fn: () => Promise<T> | T): Promise<T> => {
    await acquire(key);
    return await fn();
  };

  return Object.freeze({
    acquire,
    withLimit,
    schedule: withLimit,
    reset(key?: VenueSendLimiterKey): void {
      if (key === undefined) {
        buckets.clear();
      } else {
        buckets.delete(normalizeLimiterKey(key));
      }
    },
  });
}
