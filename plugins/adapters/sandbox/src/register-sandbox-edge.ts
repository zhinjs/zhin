import type { Plugin } from "@zhin.js/core";
import { SandboxWsHostAdapter, resolveSandboxBot } from "./sandbox-ws.js";

/**
 * Edge / Workers：在 bootstrap 的 Plugin 树上注册 sandbox，避免入口文件顶层 `usePlugin()`。
 * 由 `loadEdgePlugins` 或应用入口在 `plugin.start()` 之前调用。
 */
export function registerSandboxEdge(
  plugin: Plugin,
  appConfig: Record<string, unknown>,
): void {
  if (plugin.inject("sandbox")) {
    return;
  }

  plugin.provide({
    name: "sandbox",
    description: "Sandbox Adapter — Edge (HTTP+SSE / fetch)",
    mounted: async (p: Plugin) => {
      const live =
        (p.inject("config")?.getPrimary?.() as Record<string, unknown> | undefined) ??
        appConfig;
      const adapter = new SandboxWsHostAdapter(p, resolveSandboxBot(live));
      await adapter.start();
      adapter.registerConfiguredPlaceholder();
      return adapter;
    },
    dispose: async (adapter: SandboxWsHostAdapter) => {
      for (const bot of adapter.bots.values()) {
        await bot.$disconnect();
      }
      await adapter.stop();
    },
  } as never);
}
