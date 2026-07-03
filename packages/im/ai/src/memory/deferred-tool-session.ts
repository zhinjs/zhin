export interface DeferredToolSessionSnapshot {
  loadedTools: Record<string, number>;
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

export function touchToolInSnapshot(
  snapshot: DeferredToolSessionSnapshot,
  name: string,
  maxLoaded: number,
): DeferredToolSessionSnapshot {
  const loadedTools = { ...snapshot.loadedTools, [name]: Date.now() };
  const entries = Object.entries(loadedTools);
  if (entries.length > maxLoaded) {
    entries.sort((a, b) => a[1] - b[1]);
    const toRemove = entries.length - maxLoaded;
    for (let i = 0; i < toRemove; i++) {
      delete loadedTools[entries[i]![0]!];
    }
  }
  return { ...snapshot, loadedTools };
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
