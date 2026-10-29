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

export function touchToolInSnapshot(
  snapshot: DeferredToolSessionSnapshot,
  name: string,
  maxLoaded: number,
): DeferredToolSessionSnapshot {
  const loadedTools = { ...snapshot.loadedTools, [name]: Date.now() };
  const previousOrder = getLoadedToolNamesInLoadOrder(snapshot);
  const entries = Object.entries(loadedTools);
  if (entries.length > maxLoaded) {
    entries.sort((a, b) => a[1] - b[1]);
    const toRemove = entries.length - maxLoaded;
    for (let i = 0; i < toRemove; i++) {
      delete loadedTools[entries[i]![0]!];
    }
  }
  // Existing tools keep their position; a new tool appends. Eviction (least recently
  // used) removes from the middle, which shifts later tools and costs one cache miss.
  const loadedOrder = [...previousOrder.filter(existing => existing in loadedTools), ...(name in loadedTools && !previousOrder.includes(name) ? [name] : [])];
  return { ...snapshot, loadedTools, loadedOrder };
}

export function touchToolsInSnapshot(
  snapshot: DeferredToolSessionSnapshot,
  names: Iterable<string>,
  maxLoaded: number,
): DeferredToolSessionSnapshot {
  let next = snapshot;
  for (const name of names) {
    next = touchToolInSnapshot(next, name, maxLoaded);
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
