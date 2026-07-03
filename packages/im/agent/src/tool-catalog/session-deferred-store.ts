/**
 * Session-level loaded tool state with LRU eviction.
 * Persisted via ContextRepository session metadata bridge.
 */
export interface DeferredSessionSnapshot {
  loadedTools: Record<string, number>;
  loadedSkills: string[];
}

export class SessionDeferredToolStore {
  private readonly bySession = new Map<string, DeferredSessionSnapshot>();

  get(sessionId: string): DeferredSessionSnapshot {
    return this.bySession.get(sessionId) ?? { loadedTools: {}, loadedSkills: [] };
  }

  set(sessionId: string, snapshot: DeferredSessionSnapshot): void {
    this.bySession.set(sessionId, snapshot);
  }

  clear(sessionId: string): void {
    this.bySession.delete(sessionId);
  }

  touchTool(sessionId: string, name: string, maxLoaded: number): void {
    const snap = this.get(sessionId);
    const now = Date.now();
    snap.loadedTools[name] = now;
    this.evictLru(snap, maxLoaded);
    this.bySession.set(sessionId, snap);
  }

  touchTools(sessionId: string, names: Iterable<string>, maxLoaded: number): void {
    for (const name of names) {
      this.touchTool(sessionId, name, maxLoaded);
    }
  }

  addSkill(sessionId: string, name: string): void {
    const snap = this.get(sessionId);
    if (!snap.loadedSkills.includes(name)) {
      snap.loadedSkills.push(name);
    }
    this.bySession.set(sessionId, snap);
  }

  getLoadedToolNames(sessionId: string): string[] {
    const snap = this.get(sessionId);
    return Object.entries(snap.loadedTools)
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name);
  }

  private evictLru(snap: DeferredSessionSnapshot, maxLoaded: number): void {
    const entries = Object.entries(snap.loadedTools);
    if (entries.length <= maxLoaded) return;
    entries.sort((a, b) => a[1] - b[1]);
    const toRemove = entries.length - maxLoaded;
    for (let i = 0; i < toRemove; i++) {
      delete snap.loadedTools[entries[i]![0]!];
    }
  }
}

/** Process-wide store; ContextRepository adapters may mirror per session. */
export const sharedDeferredToolStore = new SessionDeferredToolStore();
