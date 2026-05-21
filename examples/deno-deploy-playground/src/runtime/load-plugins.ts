import * as path from "node:path";
import { resolveEntry, type Plugin } from "zhin.js";

export async function loadPlaygroundPlugins(
  plugin: Plugin,
  appConfig: Record<string, unknown>,
  projectRoot: string,
): Promise<void> {
  const names = new Set((appConfig.plugins as string[] | undefined) ?? []);
  const dirs = (appConfig.plugin_dirs as string[] | undefined) ?? ["./src/plugins"];

  for (const name of names) {
    const dir = dirs.find((d) => resolveEntry(path.join(projectRoot, d, name)));
    if (!dir) {
      plugin.logger.warn(`Plugin "${name}" not found under plugin_dirs`);
      continue;
    }
    const pluginPath = path.join(projectRoot, dir, name);
    await plugin.import(pluginPath);
  }
}
