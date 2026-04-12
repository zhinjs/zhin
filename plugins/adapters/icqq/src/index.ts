/**
 * ICQQ 适配器入口：类型扩展、导出、注册
 */
import path from "path";
import { usePlugin, type Plugin, type ToolFeature } from "zhin.js";
import type { Router } from "@zhin.js/http";
import type { WebServer } from "@zhin.js/console";
import { IcqqAdapter } from "./adapter.js";
import { registerCommands } from "./commands/index.js";
import { registerTools } from "./tools/index.js";
import { registerRoutes } from "./routes.js";

declare module "zhin.js" {
  namespace Plugin {
    interface Contexts {
      web: WebServer;
      router: Router;
    }
  }
  interface Adapters {
    icqq: IcqqAdapter;
  }
}

export * from "./types.js";
export { IcqqBot } from "./bot.js";
export { IcqqAdapter } from "./adapter.js";

const plugin = usePlugin();
const { provide, useContext, addCommand, root } = plugin;

// ── 适配器注册 ─────────────────────────────────────────────────────
provide({
  name: "icqq",
  description: "ICQQ Adapter",
  mounted: async (p: Plugin) => {
    const adapter = new IcqqAdapter(p);
    await adapter.start();
    return adapter;
  },
  dispose: async (adapter: IcqqAdapter) => {
    await adapter.stop();
  },
} as any);

// ── 命令注册 ───────────────────────────────────────────────────────
useContext("icqq", (icqq: IcqqAdapter) => {
  registerCommands(addCommand, icqq);
});

// ── AI 工具注册 ────────────────────────────────────────────────────
useContext("tool", "icqq", (toolService: ToolFeature, icqq: IcqqAdapter) => {
  return registerTools(toolService, icqq, plugin.name);
});

// ── Web 控制台入口 ─────────────────────────────────────────────────
useContext("web", (web: WebServer) => {
  return web.addEntry(
    path.resolve(import.meta.dirname, "../client/index.tsx"),
  );
});

// ── HTTP 路由 ──────────────────────────────────────────────────────
useContext("router", "icqq", async (router: Router, icqq: IcqqAdapter) => {
  registerRoutes(router, icqq, root);
});
