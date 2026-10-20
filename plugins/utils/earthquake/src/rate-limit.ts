/**
 * Sliding-window limiter for outbound pushes, keyed by conversation.
 * State lives in memory only: a restart starts every window fresh.
 */
export class SlidingWindowRateLimiter {
  readonly #limit: number;
  readonly #windowMs: number;
  readonly #now: () => number;
  readonly #history = new Map<string, number[]>();

  constructor(options: { readonly limit: number; readonly windowMs: number; readonly now?: () => number }) {
    this.#limit = options.limit;
    this.#windowMs = options.windowMs;
    this.#now = options.now ?? Date.now;
  }

  #recent(key: string, now: number): number[] {
    const since = now - this.#windowMs;
    const kept = (this.#history.get(key) ?? []).filter((timestamp) => timestamp > since);
    if (kept.length === 0) {
      this.#history.delete(key);
    } else {
      this.#history.set(key, kept);
    }
    return kept;
  }

  /** Consumes one slot when available. */
  tryAcquire(key: string): boolean {
    const now = this.#now();
    const recent = this.#recent(key, now);
    if (recent.length >= this.#limit) return false;
    recent.push(now);
    this.#history.set(key, recent);
    return true;
  }

  /** Slots left in the current window without consuming one. */
  remaining(key: string): number {
    return Math.max(0, this.#limit - this.#recent(key, this.#now()).length);
  }
}
