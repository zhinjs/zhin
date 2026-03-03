import { resolveEntry } from '@zhin.js/core';
import type { Plugin } from '@zhin.js/core';
import type { AppConfig } from '../types.js';
import * as path from 'path';

/**
 * 根据配置从 plugin_dirs 解析并 import 插件（在 start() 之前执行）
 */
export async function loadPlugins(plugin: Plugin, appConfig: AppConfig): Promise<void> {
  const pluginNames = new Set(appConfig.plugins || []);
  plugin.logger.debug(`Plugin list: ${Array.from(pluginNames).join(', ')}`);

  const dirs = appConfig.plugin_dirs || [];
  for (const pluginName of pluginNames) {
    const dir = dirs.find((d: string) => resolveEntry(path.join(d, pluginName)));
    if (dir) {
      const pluginPath = path.join(process.cwd(), dir, pluginName);
      plugin.logger.debug(`Importing plugin: ${pluginName} from ${pluginPath}`);
      await plugin.import(pluginPath);
    }
  }

  plugin.logger.debug(`${plugin.children.length} plugins loaded`);
}
