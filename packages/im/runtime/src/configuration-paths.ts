import { isDeepStrictEqual } from 'node:util';
import { applyConfigPatches, type RuntimeConfigDocument } from '@zhin.js/plugin-runtime';

export function readConfigurationPath(value: unknown, path: readonly string[]): unknown {
  for (const segment of path) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, segment)) return undefined;
    value = (value as Readonly<Record<string, unknown>>)[segment];
  }
  return value;
}

export function copyConfigurationPaths(target: RuntimeConfigDocument, source: RuntimeConfigDocument, paths: readonly (readonly string[])[]): RuntimeConfigDocument {
  return applyConfigPatches(target, paths.map(path => {
    const value = readConfigurationPath(source, path);
    return value === undefined ? { op: 'remove' as const, path } : { op: 'set' as const, path, value };
  }));
}

/** Arrays are dependency units; indices never identify independently updatable resources. */
export function changedConfigurationPaths(before: unknown, after: unknown, path: readonly string[] = []): readonly (readonly string[])[] {
  if (isDeepStrictEqual(before, after)) return [];
  const beforeObject = before === undefined ? {} : before;
  const afterObject = after === undefined ? {} : after;
  if (beforeObject && afterObject && typeof beforeObject === 'object' && typeof afterObject === 'object' && !Array.isArray(beforeObject) && !Array.isArray(afterObject)) {
    return [...new Set([...Object.keys(beforeObject), ...Object.keys(afterObject)])].flatMap(key => changedConfigurationPaths(
      (beforeObject as Record<string, unknown>)[key], (afterObject as Record<string, unknown>)[key], [...path, key]));
  }
  return [path];
}
