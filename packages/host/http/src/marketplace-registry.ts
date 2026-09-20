export interface MarketplaceRegistryOptions {
  readonly fetchFn: typeof fetch;
  readonly url: string;
  readonly ttlMs: number;
  readonly now?: () => number;
}

interface MarketplaceSnapshot {
  readonly plugins: readonly unknown[];
  readonly expiresAt: number;
}

/** Host-owned plugin registry reader with TTL caching and request coalescing. */
export class MarketplaceRegistry {
  readonly #fetch: typeof fetch;
  readonly #url: string;
  readonly #ttlMs: number;
  readonly #now: () => number;
  #snapshot?: MarketplaceSnapshot;
  #inflight?: Promise<readonly unknown[]>;

  constructor(options: MarketplaceRegistryOptions) {
    this.#fetch = options.fetchFn;
    this.#url = options.url;
    this.#ttlMs = options.ttlMs;
    this.#now = options.now ?? Date.now;
  }

  list(): Promise<readonly unknown[]> {
    const snapshot = this.#snapshot;
    if (snapshot && this.#now() < snapshot.expiresAt) {
      return Promise.resolve(snapshot.plugins);
    }
    if (this.#inflight) return this.#inflight;

    const request = this.#load();
    this.#inflight = request;
    const clearInflight = () => {
      if (this.#inflight === request) this.#inflight = undefined;
    };
    void request.then(clearInflight, clearInflight);
    return request;
  }

  async #load(): Promise<readonly unknown[]> {
    const response = await this.#fetch(this.#url, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`plugins.json fetch failed: ${response.status}`);
    const json = (await response.json()) as { plugins?: unknown[] };
    const plugins = Object.freeze([...(json.plugins ?? [])]);
    this.#snapshot = Object.freeze({
      plugins,
      expiresAt: this.#now() + this.#ttlMs,
    });
    return plugins;
  }
}
