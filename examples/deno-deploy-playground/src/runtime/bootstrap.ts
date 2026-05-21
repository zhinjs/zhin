/**
 * 启动真实 zhin.js 运行时（与 packages/zhin/src/setup.ts 同序，无 process/console/http）。
 */
import { setLevel } from "zhin.js";
import { initAgentModule, usePlugin } from "zhin.js";
import { loadPlaygroundConfig, resolveProjectRoot } from "./load-config.ts";
import { registerCoreServices } from "./register-core.ts";
import { loadPlaygroundPlugins } from "./load-plugins.ts";
import type { PlaygroundWsAdapter } from "../adapter/playground-ws.ts";

const projectRoot = resolveProjectRoot();

let root: ReturnType<typeof usePlugin> | null = null;
let playground: PlaygroundWsAdapter | null = null;

export const zhinReady: Promise<void> = startZhin();

async function startZhin(): Promise<void> {
  const plugin = usePlugin();
  root = plugin;

  const { configFeature, appConfig } = loadPlaygroundConfig(projectRoot);

  registerCoreServices(plugin, appConfig, configFeature);

  if (appConfig.log_level != null) {
    setLevel(appConfig.log_level as Parameters<typeof setLevel>[0]);
  }

  initAgentModule();

  await loadPlaygroundPlugins(plugin, appConfig, projectRoot);

  await plugin.start();

  playground = plugin.inject("playground") as PlaygroundWsAdapter | undefined ?? null;
  if (!playground) {
    throw new Error(
      'adapter-playground 未注册：请确认 zhin.config.yml 含 plugins: [demo, adapter-playground]',
    );
  }

  plugin.logger.info(
    `playground: ready; plugins: ${plugin.children.length}; ai: ${plugin.inject("ai") ? "on" : "off"}`,
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
