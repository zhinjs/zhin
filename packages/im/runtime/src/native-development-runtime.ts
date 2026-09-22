import {
  readdirSync,
  statSync,
  watch as watchDirectory,
  type FSWatcher,
} from 'node:fs';
import { basename, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Dispose } from '@zhin.js/plugin-runtime';
import { ModuleDependencyIndex } from './module-dependency-index.js';
import type { ModuleRuntime, ModuleWatchRoot } from './module-runtime.js';
import { ensureTypeScriptSpecifierRemap } from './typescript-specifier-remap.js';

export interface NativeDevelopmentModuleRuntimeOptions {
  readonly projectRoot: string;
  readonly watch?: boolean;
  /** Optional scoped loader used only when the active Node loader rejects TSX. */
  readonly tsxLoader?: TsxModuleLoader;
}

export interface TsxModuleLoader {
  load<T = unknown>(source: string, parentURL: string): Promise<T>;
  close?(): Promise<void>;
}

const ignoredDirectories = new Set([
  '.git', '.zhin', 'coverage', 'data', 'dist', 'lib', 'node_modules',
]);
const watchedExtensions = new Set([
  '.cjs', '.cts', '.js', '.json', '.jsx', '.md', '.mjs', '.mts',
  '.ts', '.tsx', '.yaml', '.yml',
]);
const capabilityRoots = new Set([
  'adapters', 'agents', 'commands', 'components', 'handlers', 'hooks', 'mcps', 'middlewares', 'pages', 'prompt-sections', 'schedules', 'skills', 'tools',
]);

/**
 * Uses Node's native ESM/TypeScript loader with dependency-aware cache busting
 * and portable filesystem watch support.
 */
export class NativeDevelopmentModuleRuntime implements ModuleRuntime {
  readonly #projectRoot: string;
  readonly #watchEnabled: boolean;
  readonly #tsxLoader: TsxModuleLoader | undefined;
  readonly #dependencies = new ModuleDependencyIndex();
  readonly #watchers = new Set<PortableSourceWatcher>();
  #watchRoots: readonly string[];
  #revision = 0;
  #closed = false;

  constructor(options: NativeDevelopmentModuleRuntimeOptions) {
    ensureTypeScriptSpecifierRemap();
    this.#projectRoot = resolve(options.projectRoot);
    this.#watchEnabled = options.watch ?? true;
    this.#tsxLoader = options.tsxLoader;
    this.#watchRoots = normalizeWatchRoots([this.#projectRoot]);
  }

  async load<T = unknown>(source: string): Promise<T> {
    this.#assertOpen();
    const normalized = resolve(source);
    if (normalized.endsWith('.ts')) assertNativeTypeScriptSupport();
    const dependencies = await this.#dependencies.analyze(normalized);
    const url = pathToFileURL(normalized);
    url.searchParams.set('zhin-generation', String(this.#revision));
    let loaded: T;
    try {
      loaded = await import(url.href) as T;
    } catch (error) {
      if (!normalized.endsWith('.tsx') || !isUnsupportedTsxError(error) || !this.#tsxLoader) {
        throw error;
      }
      loaded = await this.#tsxLoader.load<T>(
        url.href,
        pathToFileURL(`${this.#projectRoot}${sep}`).href,
      );
    }
    this.#dependencies.commit(normalized, dependencies);
    return loaded;
  }

  invalidate(_source: string): void {
    this.#revision += 1;
  }

  affectedSources(source: string): readonly string[] {
    return this.#dependencies.affectedSources(source);
  }

  requiresProcessRestart(source: string): boolean {
    const normalized = resolve(source);
    const packageRoot = nearestWatchRoot(this.#watchRoots, normalized);
    // Installed packages and external paths are intentionally not watched.
    // The HMR coordinator turns this into a visible process restart reason.
    if (!packageRoot || isNodeModulesSource(packageRoot, normalized)) return true;
    if (packageRoot === this.#projectRoot && basename(normalized).startsWith('.env')) return true;
    // A helper with one or more loaded entry importers is safe: the planner
    // invalidates those owned entries and the generation query refreshes their
    // complete project-local import closure.
    if (this.affectedSources(normalized).length > 1) return false;
    const parts = relative(packageRoot, normalized).split(sep);
    const capability = parts.findIndex((part) => capabilityRoots.has(part));
    if (capability < 0) return isExecutableSource(normalized);
    const root = parts[capability];
    if (root === 'agents' || root === 'skills') {
      const local = parts.slice(capability + 1);
      if (isNestedDirectoryEntry(local)) return false;
      return extname(normalized) !== '.md';
    }
    if (root === 'commands') {
      const local = parts.slice(capability + 1);
      if (!isExecutableSource(normalized)) return extname(normalized) === '.json';
      return local.length < 2
        || !local.slice(0, -1).every(isCommandDirectorySegment);
    }
    if (root === 'adapters' || root === 'components' || root === 'handlers'
      || root === 'hooks' || root === 'mcps' || root === 'middlewares'
      || root === 'pages' || root === 'prompt-sections' || root === 'schedules'
      || root === 'tools') {
      const local = parts.slice(capability + 1);
      if (!isExecutableSource(normalized)) return extname(normalized) === '.json';
      return local.length < 2
        || !isNamedCapabilityDirectory(local[0] ?? '', root === 'tools');
    }
    // Support files inside capability directories (e.g. commands/_utils.ts)
    // are not discovery entries: reloading the entry URL only bumps that
    // entry's zhin-generation, so the importer closure keeps the old code.
    return ['.js', '.json', '.ts', '.tsx'].includes(extname(normalized));
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
    await this.#tsxLoader?.close?.();
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error('NativeDevelopmentModuleRuntime is closed');
  }
}

function isCommandDirectorySegment(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/u.test(value)
    || (!/[A-Z]/u.test(value) && /[^\x00-\x7F]/u.test(value) && !/[\s/\\]/u.test(value))
    || /^\[(?:\[)?(?:\.\.\.)?[a-zA-Z][a-zA-Z0-9]*\](?:\])?$/u.test(value);
}

function isNamedCapabilityDirectory(value: string, allowSnake: boolean): boolean {
  return allowSnake
    ? /^[a-z0-9][a-z0-9_-]*$/u.test(value)
    : /^[a-z0-9][a-z0-9-]*$/u.test(value);
}

function isDirectoryCapabilityEntry(parts: readonly string[]): boolean {
  return parts.length === 2
    && parts[1] === `index${extname(parts[1] ?? '')}`
    && ['.cjs', '.js', '.mjs', '.ts', '.tsx'].includes(extname(parts[1] ?? ''));
}

function isNestedDirectoryEntry(parts: readonly string[]): boolean {
  const index = parts.indexOf('tools');
  const hookIndex = parts.indexOf('hooks');
  const capability = index >= 0 ? index : hookIndex;
  return capability >= 1 && isDirectoryCapabilityEntry(parts.slice(capability + 1));
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

function isUnsupportedTsxError(error: unknown): boolean {
  return error instanceof Error
    && 'code' in error
    && error.code === 'ERR_UNKNOWN_FILE_EXTENSION';
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
