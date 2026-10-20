import type { RuntimeSnapshot } from '@zhin.js/plugin-runtime';

export function readRuntimeSnapshot(
  accessor?: () => RuntimeSnapshot | undefined,
): RuntimeSnapshot | undefined {
  try {
    return accessor?.();
  } catch {
    return undefined;
  }
}
