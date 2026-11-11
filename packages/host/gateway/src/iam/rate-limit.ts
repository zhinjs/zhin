/** Login throttling: 5 failures / 15 minutes per IP and per username, then exponential lockout. */

export interface LoginRateLimitOptions {
  readonly maxFailures?: number;
  readonly windowMs?: number;
  readonly maxLockMs?: number;
  readonly now?: () => number;
}

interface Bucket {
  failures: number[];
  lockedUntil: number;
  lockouts: number;
}

export class LoginRateLimiter {
  readonly #buckets = new Map<string, Bucket>();
  readonly #max: number;
  readonly #window: number;
  readonly #maxLock: number;
  readonly #now: () => number;

  constructor(options: LoginRateLimitOptions = {}) {
    this.#max = options.maxFailures ?? 5;
    this.#window = options.windowMs ?? 15 * 60_000;
    this.#maxLock = options.maxLockMs ?? 24 * 60 * 60_000;
    this.#now = options.now ?? Date.now;
  }

  /** Milliseconds until any of `keys` may try again; 0 when allowed. */
  retryAfter(keys: readonly string[]): number {
    const now = this.#now();
    let wait = 0;
    for (const key of keys) {
      const bucket = this.#buckets.get(key);
      if (bucket && bucket.lockedUntil > now) wait = Math.max(wait, bucket.lockedUntil - now);
    }
    return wait;
  }

  fail(keys: readonly string[]): void {
    const now = this.#now();
    for (const key of keys) {
      const bucket = this.#buckets.get(key) ?? { failures: [], lockedUntil: 0, lockouts: 0 };
      bucket.failures = bucket.failures.filter(at => now - at < this.#window);
      bucket.failures.push(now);
      if (bucket.failures.length >= this.#max) {
        // 15 min, 30 min, 60 min … capped.
        bucket.lockedUntil = now + Math.min(this.#window * 2 ** bucket.lockouts, this.#maxLock);
        bucket.lockouts += 1;
        bucket.failures = [];
      }
      this.#buckets.set(key, bucket);
    }
    if (this.#buckets.size > 10_000) this.#prune(now);
  }

  succeed(keys: readonly string[]): void {
    for (const key of keys) this.#buckets.delete(key);
  }

  #prune(now: number): void {
    for (const [key, bucket] of this.#buckets) {
      if (bucket.lockedUntil <= now && bucket.failures.every(at => now - at >= this.#window)) this.#buckets.delete(key);
    }
  }
}
