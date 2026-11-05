export interface InboundDeduperOptions {
  readonly ttlMs?: number;
  readonly maxEntries?: number;
  readonly now?: () => number;
}

const DEFAULT_TTL_MS = 120_000;
const DEFAULT_MAX_ENTRIES = 2_000;

/**
 * Bounded TTL deduplicator for inbound platform message / event / update IDs.
 */
export class InboundDeduper {
  readonly #ttlMs: number;
  readonly #maxEntries: number;
  readonly #now: () => number;
  readonly #seen = new Map<string, number>();

  constructor(options: InboundDeduperOptions = {}) {
    const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new RangeError('InboundDeduper ttlMs must be a positive number');
    }
    if (!Number.isInteger(maxEntries) || maxEntries <= 0) {
      throw new RangeError('InboundDeduper maxEntries must be a positive integer');
    }
    this.#ttlMs = ttlMs;
    this.#maxEntries = maxEntries;
    this.#now = options.now ?? Date.now;
  }

  #evictExpired(currentNow: number): void {
    for (const [existingKey, expiry] of this.#seen) {
      if (expiry <= currentNow) {
        this.#seen.delete(existingKey);
      } else {
        break;
      }
    }
  }

  shouldProcess(key: string | undefined | null): boolean {
    if (typeof key !== 'string' || key.length === 0) {
      return true;
    }
    const currentNow = this.#now();
    this.#evictExpired(currentNow);
    const existingExpiry = this.#seen.get(key);
    if (existingExpiry !== undefined && existingExpiry > currentNow) {
      return false;
    }
    this.#seen.delete(key);
    this.#seen.set(key, currentNow + this.#ttlMs);
    if (this.#seen.size > this.#maxEntries) {
      this.#evictExpired(currentNow);
      while (this.#seen.size > this.#maxEntries) {
        const oldest = this.#seen.keys().next().value;
        if (oldest === undefined) break;
        this.#seen.delete(oldest);
      }
    }
    return true;
  }

  admit(key: string | undefined | null): boolean {
    return this.shouldProcess(key);
  }

  has(key: string): boolean {
    if (typeof key !== 'string' || key.length === 0) return false;
    const currentNow = this.#now();
    this.#evictExpired(currentNow);
    const existingExpiry = this.#seen.get(key);
    if (existingExpiry === undefined) return false;
    if (existingExpiry <= currentNow) {
      this.#seen.delete(key);
      return false;
    }
    return true;
  }

  delete(key: string): boolean {
    return this.#seen.delete(key);
  }

  clear(): void {
    this.#seen.clear();
  }

  get size(): number {
    this.#evictExpired(this.#now());
    return this.#seen.size;
  }
}

export { InboundDeduper as InboundMessageDeduper };
export type { InboundDeduperOptions as InboundMessageDeduperOptions };
