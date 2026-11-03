import { realpathSync } from 'node:fs';
import * as path from 'node:path';
import type { SourceOwnershipIndex } from '@zhin.js/runtime';

/** The slice of {@link SourceOwnershipIndex} that lists local (non-`node_modules`) package roots. */
export type LocalPluginRootSource = Pick<SourceOwnershipIndex, 'watchRoots'>;

/**
 * ADR 0040 §1 / #1051 F1: local plugin roots a self-change may write into (their convention dirs such as
 * `plugins/weather/commands/`), relative posix paths under the project root.
 *
 * Taken from the generation's source ownership (workspace / local packages; `node_modules` packages are never
 * listed there). A root counts only when its real path stays inside the real project root and has no
 * `node_modules` segment, so a symlink into `node_modules` or out of the project is not writable. The project
 * root itself is left out: it is always a plugin root for the path allowlist.
 */
export function localPluginRoots(projectRoot: string, ownership: LocalPluginRootSource | undefined): readonly string[] {
  if (!ownership) return Object.freeze([]);
  const realProjectRoot = realPathOrUndefined(projectRoot);
  if (!realProjectRoot) return Object.freeze([]);
  const roots = new Set<string>();
  for (const watchRoot of ownership.watchRoots()) {
    const relativeRoot = localRelativeRoot(realProjectRoot, watchRoot.root);
    if (relativeRoot) roots.add(relativeRoot);
  }
  return Object.freeze([...roots].sort());
}

/**
 * Provider for `SelfChangeStore` / trial / `SelfChangeApplier`: re-reads the committed generation's ownership on
 * every call (it is still empty while the first generation assembles, and changes with every HMR generation) and
 * caches the frozen list per ownership index.
 */
export function createSelfChangePluginRoots(
  projectRoot: string,
  sourceOwnership: (() => LocalPluginRootSource | undefined) | undefined,
): () => readonly string[] {
  const cache = new WeakMap<LocalPluginRootSource, readonly string[]>();
  const empty: readonly string[] = Object.freeze([]);
  return () => {
    const ownership = sourceOwnership?.();
    if (!ownership) return empty;
    const cached = cache.get(ownership);
    if (cached) return cached;
    const roots = localPluginRoots(projectRoot, ownership);
    cache.set(ownership, roots);
    return roots;
  };
}

function localRelativeRoot(realProjectRoot: string, candidate: string): string | undefined {
  const realCandidate = realPathOrUndefined(candidate);
  if (!realCandidate) return undefined;
  const relativePath = path.relative(realProjectRoot, realCandidate);
  if (!relativePath) return undefined;
  if (path.isAbsolute(relativePath)) return undefined;
  const segments = relativePath.split(path.sep);
  if (segments[0] === '..') return undefined;
  if (segments.includes('node_modules')) return undefined;
  return segments.join('/');
}

function realPathOrUndefined(target: string): string | undefined {
  try {
    return realpathSync(path.resolve(target));
  } catch {
    return undefined;
  }
}
