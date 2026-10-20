/**
 * Per-key async mutex — serializes concurrent async operations sharing the same key.
 */
export class KeyedMutex {
  private chains = new Map<string, Promise<void>>();

  async run<T>(key: string, fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const prev = this.chains.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const chain = prev.then(() => gate, () => gate);
    const tracked = chain.finally(() => {
      if (this.chains.get(key) === tracked) this.chains.delete(key);
    });
    this.chains.set(key, tracked);
    try {
      await waitForTurn(prev, signal);
    } catch (error) {
      release();
      throw error;
    }
    try {
      signal?.throwIfAborted();
      return await fn();
    } finally {
      release();
    }
  }

  get size(): number {
    return this.chains.size;
  }

  async drain(timeoutMs?: number): Promise<void> {
    const pending = Promise.allSettled([...this.chains.values()]).then(() => undefined);
    if (timeoutMs === undefined) {
      await pending;
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        pending,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, Math.max(0, timeoutMs));
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

async function waitForTurn(previous: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    await previous.catch(() => {});
    return;
  }
  signal.throwIfAborted();

  let rejectAborted!: (reason?: unknown) => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAborted = reject;
  });
  const onAbort = () => rejectAborted(signal.reason);
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    await Promise.race([previous.catch(() => {}), aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}
