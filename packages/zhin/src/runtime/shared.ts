import * as path from 'node:path';
import {
  ConfigLoader,
  Plugin,
  storage,
  usePlugin,
  runtimeCwd,
  type ConfigFeature,
} from '@zhin.js/core';
import type { AppConfig } from '../types.js';
import { loadConfig } from '../setup/load-config.js';
import { applyConfigAndDatabase } from '../setup/apply-config-and-database.js';
import { registerAI } from '../setup/register-ai.js';
import { loadPlugins } from '../setup/load-plugins.js';
import { getZhinProjectRoot, setZhinProjectRoot } from '../setup/project-root.js';
import type { BootstrapOptions, PreparedRuntime } from './types.js';

export function chdirToProjectRoot(root: string): void {
  const resolved = path.resolve(root);
  const g = globalThis as { Deno?: { chdir: (p: string) => void }; process?: { chdir: (p: string) => void } };
  if (g.Deno?.chdir) {
    g.Deno.chdir(resolved);
  } else if (g.process?.chdir) {
    g.process.chdir(resolved);
  }
  setZhinProjectRoot(resolved);
}

export function resolveConfigPath(): string {
  const root = getZhinProjectRoot();
  const configFile = ConfigLoader.discover('zhin.config', root) || 'zhin.config.yml';
  return path.join(root, configFile);
}

export async function prepareRuntime(
  options: BootstrapOptions & {
    configDefaults?: AppConfig;
    registerCore: (plugin: Plugin, appConfig: AppConfig, configFeature: ConfigFeature) => void;
    applyDatabase?: (plugin: Plugin, appConfig: AppConfig) => void;
    loadPluginsFn?: (plugin: Plugin, appConfig: AppConfig) => Promise<void>;
    afterPluginsLoaded?: (plugin: Plugin, appConfig: AppConfig) => Promise<void>;
  },
): Promise<PreparedRuntime> {
  if (options.projectRoot) {
    chdirToProjectRoot(options.projectRoot);
  }

  const runBody = async (): Promise<PreparedRuntime> => {
    const plugin = usePlugin();
    const { configFeature, appConfig, configPath } = loadConfig({
      ...(options.projectRoot ? { projectRoot: options.projectRoot } : {}),
      ...(options.configDefaults ? { defaults: options.configDefaults } : {}),
    });

    options.registerCore(plugin, appConfig, configFeature);

    if (options.applyDatabase) {
      options.applyDatabase(plugin, appConfig);
    } else {
      applyConfigAndDatabase(plugin, appConfig);
    }

    registerAI();

    const loadFn = options.loadPluginsFn ?? ((p, cfg) => loadPlugins(p, cfg));
    await loadFn(plugin, appConfig);

    if (options.afterPluginsLoaded) {
      await options.afterPluginsLoaded(plugin, appConfig);
    }

    if (options.autoStart !== false) {
      await plugin.start();
    }

    return { plugin, configFeature, appConfig, configPath };
  };

  if (storage.getStore()) {
    return runBody();
  }

  const root = path.join(
    options.projectRoot ?? getZhinProjectRoot() ?? runtimeCwd(),
    '__zhin_bootstrap__.mjs',
  );
  return storage.run(new Plugin(root), runBody);
}
