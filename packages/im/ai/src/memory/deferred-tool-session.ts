export interface DeferredToolSessionSnapshot {
  /** Tool name -> last-used time (drives LRU eviction). */
  loadedTools: Record<string, number>;
  /**
   * Tool names in the order they were first loaded. Provider requests send tools
   * in this order so a newly loaded tool only appends and the cached request
   * prefix stays byte-identical. Absent in legacy snapshots.
   */
  loadedOrder?: string[];
  loadedSkills: string[];
}

export const EMPTY_DEFERRED_TOOL_SNAPSHOT: DeferredToolSessionSnapshot = {
  loadedTools: {},
  loadedSkills: [],
};

/** Upper bound of in-memory session snapshots kept by a context repository. */
export const DEFERRED_TOOL_SNAPSHOT_CACHE_LIMIT = 1000;

/**
 * Bounded, least-recently-used store of per-session snapshots. Snapshots are a process-local
 * cache (a lost entry only means deferred tools are loaded again), so eviction is safe.
 */
export class DeferredToolSnapshotCache {
  readonly #entries = new Map<string, DeferredToolSessionSnapshot>();
  readonly #limit: number;

  constructor(limit: number = DEFERRED_TOOL_SNAPSHOT_CACHE_LIMIT) {
    this.#limit = Math.max(1, limit);
  }

  get size(): number {
    return this.#entries.size;
  }

  get(sessionId: string): DeferredToolSessionSnapshot | undefined {
    const snapshot = this.#entries.get(sessionId);
    if (snapshot === undefined) return undefined;
    // Re-insert so the entry becomes the most recently used.
    this.#entries.delete(sessionId);
    this.#entries.set(sessionId, snapshot);
    return snapshot;
  }

  set(sessionId: string, snapshot: DeferredToolSessionSnapshot): void {
    this.#entries.delete(sessionId);
    this.#entries.set(sessionId, snapshot);
    while (this.#entries.size > this.#limit) {
      const oldest = this.#entries.keys().next().value;
      if (oldest === undefined) break;
      this.#entries.delete(oldest);
    }
  }

  delete(sessionId: string): void {
    this.#entries.delete(sessionId);
  }
}

export function getLoadedToolNamesFromSnapshot(snapshot: DeferredToolSessionSnapshot): string[] {
  return Object.entries(snapshot.loadedTools)
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);
}

/**
 * Loaded tool names in first-load order (never re-sorted by recency), so the tool
 * list sent to the provider is stable: new tools append at the end.
 */
export function getLoadedToolNamesInLoadOrder(snapshot: DeferredToolSessionSnapshot): string[] {
  const present = new Set(Object.keys(snapshot.loadedTools));
  const ordered = (snapshot.loadedOrder ?? []).filter((name, index, all) => present.has(name) && all.indexOf(name) === index);
  const known = new Set(ordered);
  const legacy = Object.entries(snapshot.loadedTools)
    .filter(([name]) => !known.has(name))
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name);
  return [...ordered, ...legacy];
}

/** Called with the tool names a load evicted because the session exceeded its cap. */
export type DeferredToolEvictionListener = (evicted: readonly string[]) => void;

/**
 * Records a deferred tool as loaded in this session. The loaded set only grows
 * (#1250 deferred-tools-break-prefix): a tool stays in the provider tool list until
 * the session ends or is compacted, and re-using it never reorders the list. When
 * the set exceeds `maxLoaded`, the earliest-loaded tools are evicted (the list then
 * changes once, at its start) and `onEvict` is told which ones.
 */
export function touchToolInSnapshot(
  snapshot: DeferredToolSessionSnapshot,
  name: string,
  maxLoaded: number,
  onEvict?: DeferredToolEvictionListener,
): DeferredToolSessionSnapshot {
  const loadedTools = { ...snapshot.loadedTools, [name]: Date.now() };
  const previousOrder = getLoadedToolNamesInLoadOrder(snapshot);
  const order = previousOrder.includes(name) ? previousOrder : [...previousOrder, name];
  const limit = Math.max(1, maxLoaded);
  const evicted: string[] = [];
  // Evict by first-load order, never the tool being loaded now.
  for (const candidate of order) {
    if (order.length - evicted.length <= limit) break;
    if (candidate === name) continue;
    evicted.push(candidate);
    delete loadedTools[candidate];
  }
  if (evicted.length > 0) onEvict?.(evicted);
  const loadedOrder = order.filter(existing => existing in loadedTools);
  return { ...snapshot, loadedTools, loadedOrder };
}

export function touchToolsInSnapshot(
  snapshot: DeferredToolSessionSnapshot,
  names: Iterable<string>,
  maxLoaded: number,
  onEvict?: DeferredToolEvictionListener,
): DeferredToolSessionSnapshot {
  let next = snapshot;
  for (const name of names) {
    next = touchToolInSnapshot(next, name, maxLoaded, onEvict);
  }
  return next;
}

export function addSkillToSnapshot(
  snapshot: DeferredToolSessionSnapshot,
  name: string,
): DeferredToolSessionSnapshot {
  const loadedSkills = snapshot.loadedSkills.includes(name)
    ? snapshot.loadedSkills
    : [...snapshot.loadedSkills, name];
  return { ...snapshot, loadedSkills };
}
