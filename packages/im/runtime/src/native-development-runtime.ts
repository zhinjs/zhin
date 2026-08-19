import {
  readdirSync,
  statSync,
  watch as watchDirectory,
  type FSWatcher,
} from 'node:fs';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Dispose } from '@zhin.js/plugin-runtime';
import type { ModuleRuntime, ModuleWatchRoot } from './module-runtime.js';

export interface NativeDevelopmentModuleRuntimeOptions {
  readonly projectRoot: string;
  readonly watch?: boolean;
}

const ignoredDirectories = new Set([
  '.git', '.zhin', 'coverage', 'data', 'dist', 'lib', 'node_modules',
]);
const watchedExtensions = new Set([
  '.cjs', '.js', '.json', '.md', '.mjs', '.ts', '.tsx', '.yaml', '.yml',
]);
const capabilityRoots = new Set([
  'adapters', 'agents', 'commands', 'components', 'handlers', 'mcp', 'middlewares', 'pages', 'skills', 'tools',
]);

/**
 * Uses Node's native ESM/TypeScript loader and adds only cache busting and watch.
 * It deliberately requests a process restart for support modules whose cached
 * relative import closure cannot be invalidated without a custom loader.
 */
export class NativeDevelopmentModuleRuntime implements ModuleRuntime {
  readonly #projectRoot: string;
  readonly #watchEnabled: boolean;
  readonly #revisions = new Map<string, number>();
  readonly #watchers = new Set<PortableSourceWatcher>();
  #watchRoots: readonly string[];
  #closed = false;

  constructor(options: NativeDevelopmentModuleRuntimeOptions) {
    this.#projectRoot = resolve(options.projectRoot);
    this.#watchEnabled = options.watch ?? true;
    this.#watchRoots = normalizeWatchRoots([this.#projectRoot]);
  }

  async load<T = unknown>(source: string): Promise<T> {
    this.#assertOpen();
    const normalized = resolve(source);
    if (normalized.endsWith('.tsx')) {
      throw new Error(`Node native TypeScript does not support TSX: ${normalized}`);
    }
    if (normalized.endsWith('.ts')) assertNativeTypeScriptSupport();
    const url = pathToFileURL(normalized);
    url.searchParams.set('zhin-generation', String(this.#revisions.get(normalized) ?? 0));
    return import(url.href) as Promise<T>;
  }

  invalidate(source: string): void {
    const normalized = resolve(source);
    this.#revisions.set(normalized, (this.#revisions.get(normalized) ?? 0) + 1);
  }

  requiresProcessRestart(source: string): boolean {
    const normalized = resolve(source);
    const packageRoot = nearestWatchRoot(this.#watchRoots, normalized);
    // Installed packages and external paths are intentionally not watched.
    // The HMR coordinator turns this into a visible process restart reason.
    if (!packageRoot || isNodeModulesSource(packageRoot, normalized)) return true;
    const parts = relative(packageRoot, normalized).split(sep);
    const capability = parts.findIndex((part) => capabilityRoots.has(part));
    if (capability < 0) return isExecutableSource(normalized);
    const root = parts[capability];
    if (root === 'pages') return false;
    if (root === 'skills' || root === 'agents') return extname(normalized) !== '.md';
    if (root === 'tools' || root === 'mcp') return parts.length !== capability + 2;
    if (isCapabilityEntry(parts.slice(capability + 1))) return false;
    // Support files inside capability directories (e.g. commands/_utils.ts)
    // are not discovery entries: reloading the entry URL only bumps that
    // entry's zhin-generation, so the importer closure keeps the old code.
    return ['.js', '.json', '.ts'].includes(extname(normalized));
  }

  updateWatchRoots(roots: readonly ModuleWatchRoot[]): void {
    this.#assertOpen();
    const next = normalizeWatchRoots([
      this.#projectRoot,
      ...roots.map((root) => root.root),
    ]);
    if (sameRoots(this.#watchRoots, next)) return;
    this.#watchRoots = next;
    for (const watcher of this.#watchers) watcher.replaceRoots(next);
  }

  watch(listener: (source: string) => void): Dispose {
    this.#assertOpen();
    if (!this.#watchEnabled) return () => undefined;
    const watcher = new PortableSourceWatcher(this.#watchRoots, listener);
    this.#watchers.add(watcher);
    return () => {
      watcher.close();
      this.#watchers.delete(watcher);
    };
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    for (const watcher of this.#watchers) watcher.close();
    this.#watchers.clear();
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error('NativeDevelopmentModuleRuntime is closed');
  }
}

export function supportsNativeTypeScript(
  version = process.versions.node,
  execArguments: readonly string[] = process.execArgv,
  nodeOptions = process.env.NODE_OPTIONS ?? '',
): boolean {
  if (
    execArguments.includes('--experimental-strip-types')
    || /(?:^|\s)--experimental-strip-types(?:\s|$)/u.test(nodeOptions)
  ) return true;
  const [major = 0, minor = 0] = version.split('.').map(Number);
  return major > 23 || (major === 23 && minor >= 6) || (major === 22 && minor >= 18);
}

export function assertNativeTypeScriptSupport(): void {
  if (supportsNativeTypeScript()) return;
  throw new Error([
    `Node ${process.versions.node} does not enable native TypeScript by default.`,
    'Use Node >=22.18.0 or start Node with --experimental-strip-types.',
  ].join(' '));
}

class PortableSourceWatcher {
  #watchers = new Set<FSWatcher>();
  #pollTimer?: NodeJS.Timeout;
  #snapshot: ReadonlyMap<string, number>;
  #closed = false;
  #roots: readonly string[];

  constructor(
    roots: readonly string[],
    private readonly listener: (source: string) => void,
  ) {
    this.#roots = normalizeWatchRoots(roots);
    this.#snapshot = sourceSnapshot(this.#roots);
    this.#startNativeWatchers();
  }

  replaceRoots(roots: readonly string[]): void {
    if (this.#closed) return;
    const next = normalizeWatchRoots(roots);
    if (sameRoots(this.#roots, next)) return;
    // The root set and polling snapshot change together. Native handles are
    // replaced afterwards; stale handles are filtered by the committed set.
    this.#roots = next;
    this.#snapshot = sourceSnapshot(next);
    if (!this.#pollTimer) this.#startNativeWatchers();
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#closeNativeWatchers();
    if (this.#pollTimer) clearInterval(this.#pollTimer);
  }

  #startNativeWatchers(): void {
    if (this.#closed || this.#pollTimer) return;
    const next = new Set<FSWatcher>();
    try {
      for (const root of this.#roots) {
        const watcher = watchDirectory(root, { recursive: true }, (_event, name) => {
          if (!name || !this.#roots.includes(root)) return;
          const source = resolve(root, name.toString());
          if (isWatchedSource(source) && !isIgnoredSource(root, source)) this.listener(source);
        });
        watcher.on('error', () => this.#startPolling());
        next.add(watcher);
      }
    } catch {
      for (const watcher of next) watcher.close();
      this.#startPolling();
      return;
    }
    const previous = this.#watchers;
    this.#watchers = next;
    for (const watcher of previous) watcher.close();
  }

  #startPolling(): void {
    if (this.#closed || this.#pollTimer) return;
    this.#closeNativeWatchers();
    this.#pollTimer = setInterval(() => {
      const next = sourceSnapshot(this.#roots);
      const sources = new Set([...this.#snapshot.keys(), ...next.keys()]);
      for (const source of sources) {
        if (this.#snapshot.get(source) !== next.get(source)) this.listener(source);
      }
      this.#snapshot = next;
    }, 100);
  }

  #closeNativeWatchers(): void {
    for (const watcher of this.#watchers) watcher.close();
    this.#watchers.clear();
  }
}

function sourceSnapshot(roots: readonly string[]): ReadonlyMap<string, number> {
  const result = new Map<string, number>();
  const visit = (directory: string): void => {
    let entries;
    try { entries = readdirSync(directory, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      if (entry.isDirectory() && !ignoredDirectories.has(entry.name)) {
        visit(resolve(directory, entry.name));
      } else if (entry.isFile()) {
        const source = resolve(directory, entry.name);
        if (!isWatchedSource(source)) continue;
        try { result.set(source, statSync(source).mtimeMs); }
        catch { /* The next poll reports a concurrent unlink. */ }
      }
    }
  };
  for (const root of roots) visit(root);
  return result;
}

function isWatchedSource(source: string): boolean {
  const name = source.slice(source.lastIndexOf(sep) + 1);
  return watchedExtensions.has(extname(source)) || name.startsWith('.env');
}

/** Mirrors sourceSnapshot: any path segment matching an ignored directory opts out. */
function isIgnoredSource(root: string, source: string): boolean {
  return relative(root, source).split(sep).some((segment) => ignoredDirectories.has(segment));
}

/**
 * Discovery entries follow the typeScriptModules convention
 * (feature-kit typescript-convention.ts): lowercase segment directories and
 * lowercase .ts/.tsx module names only.
 */
function isCapabilityEntry(segments: readonly string[]): boolean {
  const file = segments[segments.length - 1] ?? '';
  return segments.slice(0, -1).every(isCapabilitySegment) && isCapabilityModule(file);
}

function isCapabilitySegment(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/u.test(value);
}

function isCapabilityModule(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]*\.tsx?$/u.test(value);
}

function isExecutableSource(source: string): boolean {
  return ['.cjs', '.js', '.mjs', '.ts', '.tsx'].includes(extname(source));
}

function isWithin(root: string, source: string): boolean {
  const child = relative(root, source);
  return child === '' || (!child.startsWith('..') && !isAbsolute(child));
}

function nearestWatchRoot(roots: readonly string[], source: string): string | undefined {
  return roots.find((root) => isWithin(root, source));
}

function isNodeModulesSource(root: string, source: string): boolean {
  return relative(root, source).split(sep).some((part) => part === 'node_modules');
}

function normalizeWatchRoots(roots: readonly string[]): readonly string[] {
  const sorted = [...new Set(roots.map((root) => resolve(root)))].sort(
    (left, right) => left.length - right.length,
  );
  return Object.freeze(sorted.filter((root, index) =>
    !sorted.slice(0, index).some((parent) => isWithin(parent, root)),
  ));
}

function sameRoots(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((root, index) => root === right[index]);
}
