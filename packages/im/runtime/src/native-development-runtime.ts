import {
  readdirSync,
  statSync,
  watch as watchDirectory,
  type FSWatcher,
} from 'node:fs';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Dispose } from '@zhin.js/plugin-runtime';
import type { ModuleRuntime } from './module-runtime.js';

export interface NativeDevelopmentModuleRuntimeOptions {
  readonly projectRoot: string;
  readonly watch?: boolean;
}

const ignoredDirectories = new Set([
  '.git', '.zhin', 'coverage', 'dist', 'lib', 'node_modules',
]);
const watchedExtensions = new Set([
  '.cjs', '.js', '.json', '.md', '.mjs', '.ts', '.tsx', '.yaml', '.yml',
]);
const capabilityRoots = new Set([
  'adapters', 'agents', 'commands', 'components', 'mcp', 'middlewares', 'pages', 'skills', 'tools',
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
  #closed = false;

  constructor(options: NativeDevelopmentModuleRuntimeOptions) {
    this.#projectRoot = resolve(options.projectRoot);
    this.#watchEnabled = options.watch ?? true;
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
    if (!isWithin(this.#projectRoot, normalized)) return true;
    const parts = relative(this.#projectRoot, normalized).split(sep);
    const capability = parts.findIndex((part) => capabilityRoots.has(part));
    if (capability < 0) return isExecutableSource(normalized);
    const root = parts[capability];
    if (root === 'pages') return false;
    if (root === 'skills' || root === 'agents') return extname(normalized) !== '.md';
    if (root === 'tools' || root === 'mcp') return parts.length !== capability + 2;
    return false;
  }

  watch(listener: (source: string) => void): Dispose {
    this.#assertOpen();
    if (!this.#watchEnabled) return () => undefined;
    const watcher = new PortableSourceWatcher(this.#projectRoot, listener);
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
): boolean {
  if (execArguments.includes('--experimental-strip-types')) return true;
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
  #watcher?: FSWatcher;
  #pollTimer?: NodeJS.Timeout;
  #snapshot: ReadonlyMap<string, number>;
  #closed = false;

  constructor(
    private readonly root: string,
    private readonly listener: (source: string) => void,
  ) {
    this.#snapshot = sourceSnapshot(root);
    this.#startNativeWatcher();
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#watcher?.close();
    if (this.#pollTimer) clearInterval(this.#pollTimer);
  }

  #startNativeWatcher(): void {
    try {
      this.#watcher = watchDirectory(this.root, { recursive: true }, (_event, name) => {
        if (!name) return;
        const source = resolve(this.root, name.toString());
        if (isWatchedSource(source)) this.listener(source);
      });
      this.#watcher.on('error', () => this.#startPolling());
    } catch {
      this.#startPolling();
    }
  }

  #startPolling(): void {
    if (this.#closed || this.#pollTimer) return;
    this.#watcher?.close();
    this.#watcher = undefined;
    this.#pollTimer = setInterval(() => {
      const next = sourceSnapshot(this.root);
      const sources = new Set([...this.#snapshot.keys(), ...next.keys()]);
      for (const source of sources) {
        if (this.#snapshot.get(source) !== next.get(source)) this.listener(source);
      }
      this.#snapshot = next;
    }, 100);
  }
}

function sourceSnapshot(root: string): ReadonlyMap<string, number> {
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
  visit(root);
  return result;
}

function isWatchedSource(source: string): boolean {
  const name = source.slice(source.lastIndexOf(sep) + 1);
  return watchedExtensions.has(extname(source)) || name.startsWith('.env');
}

function isExecutableSource(source: string): boolean {
  return ['.cjs', '.js', '.mjs', '.ts', '.tsx'].includes(extname(source));
}

function isWithin(root: string, source: string): boolean {
  const child = relative(root, source);
  return child === '' || (!child.startsWith('..') && !isAbsolute(child));
}
