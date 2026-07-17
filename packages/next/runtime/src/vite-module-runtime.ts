import { createServer, type ModuleNode, type ViteDevServer } from 'vite';
import type { ModuleRuntime } from './module-runtime.js';

export class ViteModuleRuntime implements ModuleRuntime {
  readonly #server: ViteDevServer;

  private constructor(server: ViteDevServer) {
    this.#server = server;
  }

  static async create(root: string): Promise<ViteModuleRuntime> {
    const server = await createServer({
      root,
      appType: 'custom',
      server: { middlewareMode: true, hmr: false, ws: false },
    });
    return new ViteModuleRuntime(server);
  }

  async load<T>(source: string): Promise<T> {
    return this.#server.ssrLoadModule(source) as Promise<T>;
  }

  invalidate(source: string): void {
    const modules = this.#server.moduleGraph.getModulesByFile(source);
    if (!modules || modules.size === 0) {
      this.#server.moduleGraph.invalidateAll();
      return;
    }
    const seen = new Set<ModuleNode>();
    const timestamp = Date.now();
    for (const module of modules) {
      this.#server.moduleGraph.invalidateModule(module, seen, timestamp, true);
    }
    this.#server.moduleGraph.invalidateAll();
  }

  async close(): Promise<void> {
    await this.#server.close();
  }
}
