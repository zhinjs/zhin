import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigFeature, ConfigLoader } from "zhin.js";
import { LogLevel } from "zhin.js";

/** 与 packages/zhin DEFAULT_APP_CONFIG 对齐，默认不拉 http/console/sandbox 插件 */
export const DEFAULT_APP_CONFIG = {
  log_level: LogLevel.INFO,
  bots: [] as never[],
  plugin_dirs: ["./src/plugins"],
  plugins: ["demo", "adapter-playground"],
  services: ["config", "command", "component", "permission", "cron"] as const,
};

export function loadPlaygroundConfig(projectRoot: string) {
  Deno.chdir(projectRoot);
  const configFile = ConfigLoader.discover("zhin.config") || "zhin.config.yml";
  const resolved = path.resolve(projectRoot, configFile);
  const configFeature = new ConfigFeature();
  configFeature.load(configFile, DEFAULT_APP_CONFIG);
  const appConfig = configFeature.getPrimary<Record<string, unknown>>();
  return { configFeature, appConfig, resolved };
}

export function resolveProjectRoot(): string {
  return path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
}
