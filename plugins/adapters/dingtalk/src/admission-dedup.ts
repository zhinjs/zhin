/**
 * #1250 b115: DingTalk redelivers a callback it did not see acknowledged (and Stream may resend one msgId
 * under a new frame messageId). One msgId is handed to the Runtime once per window:
 * - a redelivery while the first hand-off is in flight shares it;
 * - a completed hand-off is kept for `ttlMs`, so later redeliveries are skipped;
 * - a failed hand-off is released, so a redelivery is handed off again.
 * At capacity the oldest completed entry is evicted; in-flight entries are never evicted, and when they
 * alone fill the table a new msgId is refused (the caller does not acknowledge it, DingTalk retries).
 */
export class AdmissionDedup {
  readonly #entries = new Map<string, { readonly promise: Promise<void>; expires: number }>();
  readonly #ttlMs: number;
  readonly #capacity: number;
  constructor(options: { readonly ttlMs: number; readonly capacity: number }) {
    this.#ttlMs = options.ttlMs;
    this.#capacity = options.capacity;
  }

  get size(): number { return this.#entries.size; }

  async admit(id: string, handoff: () => Promise<void>): Promise<void> {
    const now = Date.now();
    for (const [key, entry] of this.#entries) if (entry.expires <= now) this.#entries.delete(key);
    const existing = this.#entries.get(id);
    if (existing) return existing.promise;
    if (this.#entries.size >= this.#capacity) {
      // Evict the oldest completed entry; in-flight ones stay so a concurrent redelivery still shares them.
      for (const [key, entry] of this.#entries) if (entry.expires !== Infinity) { this.#entries.delete(key); break; }
      if (this.#entries.size >= this.#capacity) throw new Error('DingTalk admission dedup capacity exhausted');
    }
    const entry = { promise: handoff(), expires: Infinity };
    this.#entries.set(id, entry);
    try {
      await entry.promise;
      if (this.#entries.get(id) === entry) entry.expires = Date.now() + this.#ttlMs;
    } catch (error) {
      // Not handed over: a redelivery must be admitted again.
      if (this.#entries.get(id) === entry) this.#entries.delete(id);
      throw error;
    }
  }

  clear(): void { this.#entries.clear(); }
}
