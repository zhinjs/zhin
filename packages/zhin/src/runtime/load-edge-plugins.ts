import * as path from 'node:path';
import { registerSandboxEdge } from '@zhin.js/adapter-sandbox/edge';
import { resolveEntry, type Plugin } from '@zhin.js/core';
import type { AppConfig } from '../types.js';
import { getZhinProjectRoot } from '../setup/project-root.js';

/** Edge 内置包插件：由显式注册函数加载，避免 Workers 动态 import() */
const EDGE_BUILTIN_PLUGINS = new Set(['adapter-sandbox']);

/** Edge 由 bootstrapEdgeCore + edge-http 提供 HTTP/Console，勿再 import 宿主插件 */
const EDGE_SKIP_IMPORT_PACKAGES = new Set([
  '@zhin.js/http',
  '@zhin.js/console',
]);

export type LoadEdgePluginsOptions = {
  projectRoot?: string;
  packagePlugins?: Record<string, string>;
};

/** Edge：支持 npm 包名插件 + plugin_dirs 本地插件 */
export async function loadEdgePlugins(
  plugin: Plugin,
  appConfig: AppConfig,
  options: LoadEdgePluginsOptions = {},
): Promise<void> {
  const names = new Set(appConfig.plugins ?? []);
  const dirs = appConfig.plugin_dirs ?? ['./src/plugins'];
  const root = options.projectRoot ?? getZhinProjectRoot();
  for (const name of names) {
    if (EDGE_BUILTIN_PLUGINS.has(name)) {
      if (name === 'adapter-sandbox') {
        registerSandboxEdge(plugin, appConfig as Record<string, unknown>);
      }
      continue;
    }

    const pkg = options.packagePlugins?.[name] ?? (name.startsWith('@') ? name : undefined);
    if (pkg) {
      if (EDGE_SKIP_IMPORT_PACKAGES.has(pkg)) {
        plugin.logger.debug(`Edge skip host plugin package: ${pkg}`);
        continue;
      }
      await import(pkg);
      continue;
    }
    const dir = dirs.find((d) => resolveEntry(path.join(root, d, name)));
    if (!dir) {
      plugin.logger.warn(`Plugin "${name}" not found under plugin_dirs`);
      continue;
    }
    await plugin.import(path.join(root, dir, name));
  }
}
