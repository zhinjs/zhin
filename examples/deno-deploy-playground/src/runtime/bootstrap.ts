/**
 * 启动真实 zhin.js 运行时（与 packages/zhin/src/setup.ts 同序，无 process/@zhin.js/http 插件）。
 */
import { setLevel } from "zhin.js";
import { initAgentModule, usePlugin } from "zhin.js";
import { loadPlaygroundConfig, resolveProjectRoot } from "./load-config.ts";
import {
  resolveEdgeConfig,
  resolveHttpConfig,
  type PlaygroundEdgeConfig,
  type PlaygroundHttpConfig,
} from "./http-config.ts";
import { applyPlaygroundDatabase } from "./apply-database.ts";
import { resolvePlaygroundDatabaseConfig } from "./resolve-database-config.ts";
import { registerCoreServices } from "./register-core.ts";
import { loadPlaygroundPlugins } from "./load-plugins.ts";
import type { PlaygroundWsAdapter } from "../adapter/playground-ws.ts";

const projectRoot = resolveProjectRoot();

let root: ReturnType<typeof usePlugin> | null = null;
let playground: PlaygroundWsAdapter | null = null;
let configPath = "";
let httpConfig: PlaygroundHttpConfig | null = null;
let edgeConfig: PlaygroundEdgeConfig | null = null;

export const zhinReady: Promise<void> = startZhin();

async function startZhin(): Promise<void> {
  const plugin = usePlugin();
  root = plugin;

  const loaded = loadPlaygroundConfig(projectRoot);
  configPath = loaded.resolved;
  httpConfig = resolveHttpConfig(loaded.appConfig);
  edgeConfig = resolveEdgeConfig(loaded.appConfig);

  registerCoreServices(plugin, loaded.appConfig, loaded.configFeature);
  const dbConfig = resolvePlaygroundDatabaseConfig(loaded.appConfig);
  const databaseOn = applyPlaygroundDatabase(plugin, loaded.appConfig);

  if (loaded.appConfig.log_level != null) {
    setLevel(loaded.appConfig.log_level as Parameters<typeof setLevel>[0]);
  }

  initAgentModule();

  await loadPlaygroundPlugins(plugin, loaded.appConfig, projectRoot);

  await plugin.start();

  playground = plugin.inject("playground") as PlaygroundWsAdapter | undefined ?? null;
  if (!playground) {
    throw new Error(
      'adapter-playground 未注册：请确认 zhin.config.yml 含 plugins: [demo, adapter-playground]',
    );
  }

  plugin.logger.info(`config: ${configPath}`);
  plugin.logger.info(
    `playground: ready; plugins: ${plugin.children.length}; database: ${databaseOn ? dbConfig?.dialect ?? "on" : "off"}; ai: ${plugin.inject("ai") ? "on" : "off"}; http.port: ${httpConfig.port}`,
  );
}

export function getPlaygroundAdapter(): PlaygroundWsAdapter {
  if (!playground) {
    throw new Error("Zhin runtime not ready");
  }
  return playground;
}

export function getRootPlugin() {
  if (!root) throw new Error("Zhin runtime not ready");
  return root;
}

export function getPlaygroundConfigPath(): string {
  if (!configPath) throw new Error("Zhin runtime not ready");
  return configPath;
}

export function getPlaygroundHttpConfig(): PlaygroundHttpConfig {
  if (!httpConfig) throw new Error("Zhin runtime not ready");
  return httpConfig;
}

export function getPlaygroundEdgeConfig(): PlaygroundEdgeConfig {
  if (!edgeConfig) throw new Error("Zhin runtime not ready");
  return edgeConfig;
}
