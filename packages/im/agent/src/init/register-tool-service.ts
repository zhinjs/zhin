/**
 * Register ToolFeature into the plugin system.
 */
import { getPlugin, ToolFeature } from '@zhin.js/core';

export function registerToolService(): void {
  const plugin = getPlugin();
  plugin.provide(new ToolFeature());
}
