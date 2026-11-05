export interface TtlLookupCacheOptions {
  readonly ttlMs: number;
  readonly maxEntries?: number;
  readonly now?: () => number;
}

const DEFAULT_MAX_ENTRIES = 2_000;

interface CacheRecord<V> {
  readonly value: V;
  readonly expiresAt: number;
}

/**
 * Bounded TTL lookup cache with singleflight `getOrLoad` support for adapter metadata lookups.
 */
export class TtlLookupCache<K, V> {
  readonly #ttlMs: number;
  readonly #maxEntries: number;
  readonly #now: () => number;
  readonly #entries = new Map<K, CacheRecord<V>>();
  readonly #inflight = new Map<K, Promise<V>>();

  constructor(options: TtlLookupCacheOptions) {
    if (!Number.isFinite(options.ttlMs) || options.ttlMs <= 0) {
      throw new RangeError('TtlLookupCache ttlMs must be a positive number');
    }
    const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    if (!Number.isInteger(maxEntries) || maxEntries <= 0) {
      throw new RangeError('TtlLookupCache maxEntries must be a positive integer');
    }
    this.#ttlMs = options.ttlMs;
    this.#maxEntries = maxEntries;
    this.#now = options.now ?? Date.now;
  }

  #evictExpired(currentNow: number): void {
    for (const [k, record] of this.#entries) {
      if (record.expiresAt <= currentNow) {
        this.#entries.delete(k);
      }
    }
  }

  get(key: K): V | undefined {
    const record = this.#entries.get(key);
    if (!record) return undefined;
    if (record.expiresAt <= this.#now()) {
      this.#entries.delete(key);
      return undefined;
    }
    return record.value;
  }

  set(key: K, value: V, customTtlMs?: number): void {
    const ttl = customTtlMs ?? this.#ttlMs;
    if (!Number.isFinite(ttl) || ttl <= 0) {
      this.#entries.delete(key);
      return;
    }
    const currentNow = this.#now();
    this.#entries.delete(key);
    this.#entries.set(key, { value, expiresAt: currentNow + ttl });
    if (this.#entries.size > this.#maxEntries) {
      this.#evictExpired(currentNow);
      while (this.#entries.size > this.#maxEntries) {
        const oldest = this.#entries.keys().next().value;
        if (oldest === undefined) break;
        this.#entries.delete(oldest);
      }
    }
  }

  async getOrLoad(
    key: K,
    loader: () => Promise<V>,
    options?: {
      readonly cacheWhen?: (value: V) => boolean;
      readonly ttlMs?: number;
    },
  ): Promise<V> {
    const cached = this.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const existing = this.#inflight.get(key);
    if (existing) {
      return existing;
    }
    const task = (async () => {
      const value = await loader();
      const shouldCache = options?.cacheWhen ? options.cacheWhen(value) : true;
      if (shouldCache) {
        this.set(key, value, options?.ttlMs);
      }
      return value;
    })();
    const tracked = task.finally(() => {
      if (this.#inflight.get(key) === tracked) {
        this.#inflight.delete(key);
      }
    });
    this.#inflight.set(key, tracked);
    return tracked;
  }

  delete(key: K): boolean {
    return this.#entries.delete(key);
  }

  clear(): void {
    this.#entries.clear();
    this.#inflight.clear();
  }

  get size(): number {
    this.#evictExpired(this.#now());
    return this.#entries.size;
  }
}
