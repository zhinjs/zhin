/**
 * Per-session write serialization for parallel LLM turns (ADR 0009 parallel turn).
 */
export class SessionWriteLock {
  private readonly tails = new Map<string, Promise<void>>();

  async run<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(sessionId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const next = prev.then(() => gate, () => gate);
    this.tails.set(sessionId, next);
    await prev.catch(() => {});
    try {
      return await fn();
    } finally {
      release();
      if (this.tails.get(sessionId) === next) {
        this.tails.delete(sessionId);
      }
    }
  }

  dispose(): void {
    this.tails.clear();
  }
}
