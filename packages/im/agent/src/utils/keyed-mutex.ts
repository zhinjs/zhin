/**
 * Per-key async mutex — serializes concurrent async operations sharing the same key.
 */
export class KeyedMutex {
  private chains = new Map<string, Promise<void>>();

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const chain = prev.then(() => gate, () => gate);
    this.chains.set(key, chain.finally(() => {
      if (this.chains.get(key) === chain) this.chains.delete(key);
    }));
    await prev.catch(() => {});
    try {
      return await fn();
    } finally {
      release();
    }
  }

  get size(): number {
    return this.chains.size;
  }

  async drain(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (this.chains.size > 0 && Date.now() < deadline) {
      await Promise.allSettled([...this.chains.values()]);
    }
    this.chains.clear();
  }
}
