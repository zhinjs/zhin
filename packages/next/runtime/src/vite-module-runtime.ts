import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { createServer, type ModuleNode, type ViteDevServer } from 'vite';
import type { Dispose } from '@zhin.js/next-kernel';
import type { ModuleRuntime } from './module-runtime.js';

export class ViteModuleRuntime implements ModuleRuntime {
  readonly #server: ViteDevServer;
  readonly #root: string;
  readonly #canonicalRoot: string;

  private constructor(server: ViteDevServer, root: string, canonicalRoot: string) {
    this.#server = server;
    this.#root = root;
    this.#canonicalRoot = canonicalRoot;
  }

  static async create(root: string): Promise<ViteModuleRuntime> {
    const projectRoot = resolve(root);
    const server = await createServer({
      root: projectRoot,
      appType: 'custom',
      server: { middlewareMode: true, hmr: false, ws: false },
    });
    return new ViteModuleRuntime(server, projectRoot, await realpath(projectRoot));
  }

  async load<T>(source: string): Promise<T> {
    return this.#server.ssrLoadModule(source) as Promise<T>;
  }

  invalidate(source: string): void {
    const modules = this.#modulesForSource(source);
    if (modules.size === 0) {
      this.#server.moduleGraph.invalidateAll();
      return;
    }
    const seen = new Set<ModuleNode>();
    const timestamp = Date.now();
    for (const module of modules) {
      this.#server.moduleGraph.invalidateModule(module, seen, timestamp, true);
    }
    // Vite 6 keeps a separate SSR evaluation cache. invalidateAll is the
    // conservative execution step; affectedSources() still preserves the
    // precise reverse closure used by Zhin's replacement planner.
    this.#server.moduleGraph.invalidateAll();
  }

  affectedSources(source: string): readonly string[] {
    const affected = new Set<string>([resolve(source)]);
    const pending = [...this.#modulesForSource(source)];
    const visited = new Set<ModuleNode>();
    while (pending.length > 0) {
      const module = pending.pop();
      if (!module) continue;
      if (visited.has(module)) continue;
      visited.add(module);
      if (module.file) affected.add(this.#toProjectPath(module.file));
      pending.push(...module.importers);
    }
    return Object.freeze([...affected]);
  }

  #modulesForSource(source: string): ReadonlySet<ModuleNode> {
    const modules = new Set<ModuleNode>();
    // TypeScript recommends .js specifiers for Node ESM. Vite can therefore
    // index an imported .ts file under its emitted .js name while chokidar
    // reports the physical .ts path.
    for (const candidate of sourceCandidates(source, this.#root, this.#canonicalRoot)) {
      for (const module of this.#server.moduleGraph.getModulesByFile(candidate) ?? []) {
        modules.add(module);
      }
    }
    return modules;
  }

  #toProjectPath(source: string): string {
    const path = relative(this.#canonicalRoot, source);
    return path === '' || (!path.startsWith('..') && !isAbsolute(path))
      ? resolve(this.#root, path)
      : resolve(source);
  }

  watch(listener: (source: string) => void): Dispose {
    const notify = (source: string): void => listener(resolve(source));
    this.#server.watcher.on('change', notify);
    this.#server.watcher.on('add', notify);
    this.#server.watcher.on('unlink', notify);
    return () => {
      this.#server.watcher.off('change', notify);
      this.#server.watcher.off('add', notify);
      this.#server.watcher.off('unlink', notify);
    };
  }

  async close(): Promise<void> {
    await this.#server.close();
  }
}

function sourceCandidates(
  source: string,
  projectRoot: string,
  canonicalRoot: string,
): readonly string[] {
  const absolute = resolve(source);
  const path = relative(projectRoot, absolute);
  const canonical =
    path === '' || (!path.startsWith('..') && !isAbsolute(path))
      ? resolve(canonicalRoot, path)
      : absolute;
  const candidates = new Set([absolute, canonical]);
  for (const candidate of [...candidates]) {
    candidates.add(
      candidate
        .replace(/\.mts$/u, '.mjs')
        .replace(/\.cts$/u, '.cjs')
        .replace(/\.tsx?$/u, '.js'),
    );
  }
  return [...candidates];
}
