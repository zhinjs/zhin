/** In-memory sliding-window rate limiter (per gate instance). */
export class SlidingWindowRateLimiter {
  readonly #windowMs: number
  readonly #max: number
  readonly #now: () => number
  #hits: number[] = []

  constructor(windowMs: number, max: number, now: () => number = () => Date.now()) {
    if (windowMs <= 0 || max <= 0) {
      throw new RangeError('windowMs and max must be positive')
    }
    this.#windowMs = windowMs
    this.#max = max
    this.#now = now
  }

  /** Returns true if the attempt is allowed and recorded. */
  tryTake(): boolean {
    const t = this.#now()
    const cutoff = t - this.#windowMs
    this.#hits = this.#hits.filter((x) => x > cutoff)
    if (this.#hits.length >= this.#max) {
      return false
    }
    this.#hits.push(t)
    return true
  }
}
