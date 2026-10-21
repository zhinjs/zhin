import { resolve } from 'node:path';
import { definePlugin, type PluginDefinition } from 'zhin.js/plugin-runtime';
import type { AdapterDefinition } from 'zhin.js/adapter';
import type { ModuleRuntime } from '@zhin.js/runtime';

/** Only the test application's setup is decorated; discovery and module caching stay native. */
export function withTestEndpoints(
  delegate: ModuleRuntime,
  rootEntry: string,
  endpoints: ReadonlyMap<string, AdapterDefinition>,
): ModuleRuntime {
  return {
    async load<T>(source: string): Promise<T> {
      const loaded = await delegate.load<T>(source);
      const candidate = loaded as { default?: PluginDefinition };
      if (resolve(source) !== rootEntry || !candidate.default) return loaded;
      const original = candidate.default;
      const definition = definePlugin({
        ...original,
        async setup(context) {
          for (const [name, endpoint] of endpoints) context.addAdapter(name, endpoint);
          return original.setup?.(context);
        },
      });
      return { ...loaded, default: definition } as T;
    },
    ...(delegate.loadClientModule ? { loadClientModule: delegate.loadClientModule.bind(delegate) } : {}),
    ...(delegate.invalidate ? { invalidate: delegate.invalidate.bind(delegate) } : {}),
    ...(delegate.affectedSources ? { affectedSources: delegate.affectedSources.bind(delegate) } : {}),
    ...(delegate.requiresProcessRestart ? { requiresProcessRestart: delegate.requiresProcessRestart.bind(delegate) } : {}),
    ...(delegate.beginGeneration ? { beginGeneration: delegate.beginGeneration.bind(delegate) } : {}),
    ...(delegate.commitGeneration ? { commitGeneration: delegate.commitGeneration.bind(delegate) } : {}),
    ...(delegate.rollbackGeneration ? { rollbackGeneration: delegate.rollbackGeneration.bind(delegate) } : {}),
    ...(delegate.updateWatchRoots ? { updateWatchRoots: delegate.updateWatchRoots.bind(delegate) } : {}),
    ...(delegate.watch ? { watch: delegate.watch.bind(delegate) } : {}),
    close: () => delegate.close(),
  };
}
