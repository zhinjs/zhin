import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigFeature, ConfigLoader } from "zhin.js";
import { LogLevel } from "zhin.js";

/** 与 packages/zhin DEFAULT_APP_CONFIG 对齐；HTTP 由 Edge Fetch 层读取 `http:`（不加载 @zhin.js/http 插件） */
export const DEFAULT_APP_CONFIG = {
  log_level: LogLevel.INFO,
  bots: [] as never[],
  plugin_dirs: ["./src/plugins"],
  plugins: ["demo", "adapter-playground"],
  services: ["config", "command", "component", "permission", "cron"] as const,
  database: {
    dialect: "sqlite",
    filename: "./data/playground.db",
  },
  http: {
    port: 8000,
    host: "0.0.0.0",
    token: "",
    base: "/api",
    corsOrigins: ["https://console.zhin.dev", "http://127.0.0.1:5173"],
    trustProxy: false,
  },
  edge: {
    queue: { botId: "playground-edge" },
    consoleParity: "edge",
  },
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
