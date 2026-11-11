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

/** npm package name grammar (optionally scoped, lower-case, URL-safe, at most 214 chars). */
const NPM_PACKAGE_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/u;

export function isValidNpmPackageName(name: string): boolean {
  return name.length > 0 && name.length <= 214 && NPM_PACKAGE_NAME.test(name);
}

export interface MarketplaceDetailCacheOptions<T> {
  readonly load: (name: string) => Promise<T>;
  readonly ttlMs: number;
  readonly maxEntries: number;
  readonly now?: () => number;
}

/**
 * Per-package detail cache: TTL, bounded size (oldest entry evicted first) and
 * coalescing of concurrent loads. Failures are not cached.
 */
export class MarketplaceDetailCache<T> {
  readonly #load: (name: string) => Promise<T>;
  readonly #ttlMs: number;
  readonly #maxEntries: number;
  readonly #now: () => number;
  readonly #entries = new Map<string, { readonly value: T; readonly expiresAt: number }>();
  readonly #inflight = new Map<string, Promise<T>>();

  constructor(options: MarketplaceDetailCacheOptions<T>) {
    this.#load = options.load;
    this.#ttlMs = options.ttlMs;
    this.#maxEntries = Math.max(1, options.maxEntries);
    this.#now = options.now ?? Date.now;
  }

  get size(): number {
    return this.#entries.size;
  }

  get(name: string): Promise<T> {
    const cached = this.#entries.get(name);
    if (cached && this.#now() < cached.expiresAt) return Promise.resolve(cached.value);
    const pending = this.#inflight.get(name);
    if (pending) return pending;

    const request = this.#load(name).then((value) => {
      this.#entries.delete(name);
      this.#entries.set(name, { value, expiresAt: this.#now() + this.#ttlMs });
      while (this.#entries.size > this.#maxEntries) {
        const oldest = this.#entries.keys().next().value;
        if (oldest === undefined) break;
        this.#entries.delete(oldest);
      }
      return value;
    });
    this.#inflight.set(name, request);
    const clear = () => {
      if (this.#inflight.get(name) === request) this.#inflight.delete(name);
    };
    void request.then(clear, clear);
    return request;
  }
}
