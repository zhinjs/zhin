import type { DeferredToolSessionSnapshot } from '@zhin.js/ai';
import { DEFERRED_META_TOOL_NAMES } from '../tool-catalog/types.js';
import { getDeferredSnapshotBefore } from './turn-context.js';

export function computeDeferredDelta(
  after: DeferredToolSessionSnapshot,
  alwaysLoadedTools: Iterable<string> = [],
  beforeOverride?: DeferredToolSessionSnapshot,
): { tools: string[]; skills: string[] } {
  const before = beforeOverride ?? getDeferredSnapshotBefore();
  if (!before) {
    return { tools: [], skills: [] };
  }

  const excludeTools = new Set<string>([
    ...DEFERRED_META_TOOL_NAMES,
    ...alwaysLoadedTools,
  ]);

  const beforeSkills = new Set(before.loadedSkills);
  const skills = after.loadedSkills.filter((name) => !beforeSkills.has(name));

  const beforeToolKeys = new Set(Object.keys(before.loadedTools));
  const tools = Object.keys(after.loadedTools).filter((name) => {
    if (beforeToolKeys.has(name)) return false;
    if (excludeTools.has(name)) return false;
    return true;
  });

  return { tools, skills };
}
