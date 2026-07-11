/**
 * KOOK 适配器入口：类型扩展、导出、注册
 */
import path from "node:path";
import { usePlugin, type Plugin, type ISceneManagement, createSceneManagementTools, type ToolFeature } from "zhin.js";
import { KookAdapter } from "./adapter.js";
import { kookGroupPermitResolver, registerKookPlatformPermitChecker } from "./platform-permit.js";
import { setKookAgentDeps } from "./kook-agent-deps.js";
import { PageManager } from "@zhin.js/host-api";

declare module "zhin.js" {
  namespace Plugin {
    interface Contexts {
      web: PageManager;
    }
  }
}

declare module "zhin.js" {
  interface Adapters {
    kook: KookAdapter;
  }
}

export * from "./types.js";
export { KookEndpoint } from "./endpoint.js";
export { KookAdapter } from "./adapter.js";

const plugin = usePlugin();
const { provide, useContext } = plugin;

provide({
  name: "kook",
  description: "KOOK Adapter",
  mounted: async (p: Plugin) => {
    const adapter = new KookAdapter(p);
    await adapter.start();
    return adapter;
  },
  dispose: async (adapter: KookAdapter) => {
    await adapter.stop();
  },
});

useContext('tool', 'kook', (toolService: ToolFeature, kook: KookAdapter) => {
  const disposers: (() => void)[] = [];
  disposers.push(registerKookPlatformPermitChecker());
  setKookAgentDeps({
    getEndpoint: (endpointId) => {
      const endpoint = kook.endpoints.get(endpointId);
      if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
      return endpoint;
    },
    getAdapter: () => kook,
  });
  const sceneTools = createSceneManagementTools(
    kook as unknown as ISceneManagement,
    'kook',
    { permitResolver: kookGroupPermitResolver, registerChecker: false },
  );
  disposers.push(...sceneTools.map(t => toolService.addTool(t, plugin.name)));

  return () => disposers.forEach(d => d());
});

// ── Web 控制台 ─────────────────────────────────────────────────────────
useContext("web", (pageManager) => {
  pageManager.addEntry({
    id: "kook",
    development: path.resolve(import.meta.dirname, "../client/index.tsx"),
    production: path.resolve(import.meta.dirname, "../dist/index.js"),
    meta: { name: "KOOK" },
  });
});

useContext("router", "kook", (router: any, kook: KookAdapter) => {
  router.get("/api/kook/endpoints", async (ctx: any) => {
    try {
      const endpoints = Array.from(kook.endpoints.values());
      const result = endpoints.map((endpoint: any) => {
        try {
          return {
            name: endpoint.$config.name,
            connected: endpoint.$connected || false,
            guildCount: endpoint.guilds?.size || 0,
            status: endpoint.$connected ? "online" : "offline",
          };
        } catch {
          return { name: endpoint.$config.name, connected: false, guildCount: 0, status: "error" };
        }
      });
      ctx.body = { success: true, data: result };
    } catch {
      ctx.status = 500;
      ctx.body = { success: false, error: "获取 Endpoint 数据失败" };
    }
  });

  // Endpoint 连接/断开
  router.post("/api/kook/endpoints/:name/connect", async (ctx: any) => {
    try {
      const endpoint = kook.endpoints.get(ctx.params.name);
      if (!endpoint) { ctx.status = 404; ctx.body = { success: false, error: "Endpoint 不存在" }; return; }
      if (endpoint.$connected) { ctx.body = { success: true, message: "已经在线" }; return; }
      await endpoint.$connect();
      ctx.body = { success: true, message: "连接成功" };
    } catch (e: unknown) {
      ctx.status = 500;
      ctx.body = { success: false, error: e instanceof Error ? e.message : "连接失败" };
    }
  });

  router.post("/api/kook/endpoints/:name/disconnect", async (ctx: any) => {
    try {
      const endpoint = kook.endpoints.get(ctx.params.name);
      if (!endpoint) { ctx.status = 404; ctx.body = { success: false, error: "Endpoint 不存在" }; return; }
      if (!endpoint.$connected) { ctx.body = { success: true, message: "已经离线" }; return; }
      await endpoint.$disconnect();
      ctx.body = { success: true, message: "已断开" };
    } catch (e: unknown) {
      ctx.status = 500;
      ctx.body = { success: false, error: e instanceof Error ? e.message : "断开失败" };
    }
  });

  // 角色列表
  router.get("/api/kook/endpoints/:name/guilds/:guildId/roles", async (ctx: any) => {
    try {
      const endpoint: any = kook.endpoints.get(ctx.params.name);
      if (!endpoint) { ctx.status = 404; ctx.body = { success: false, error: "Endpoint 不存在" }; return; }
      if (!endpoint.$connected) { ctx.status = 400; ctx.body = { success: false, error: "Endpoint 未连接" }; return; }
      const roles = await endpoint.getRoleList(ctx.params.guildId);
      ctx.body = {
        success: true,
        data: roles.map((r: any) => ({
          id: r.role_id,
          name: r.name,
          color: r.color,
          position: r.position,
        })),
      };
    } catch (e: unknown) {
      ctx.status = 500;
      ctx.body = { success: false, error: e instanceof Error ? e.message : "获取角色列表失败" };
    }
  });

  // 创建角色
  router.post("/api/kook/endpoints/:name/guilds/:guildId/roles", async (ctx: any) => {
    try {
      const endpoint: any = kook.endpoints.get(ctx.params.name);
      if (!endpoint) { ctx.status = 404; ctx.body = { success: false, error: "Endpoint 不存在" }; return; }
      if (!endpoint.$connected) { ctx.status = 400; ctx.body = { success: false, error: "Endpoint 未连接" }; return; }
      const { name } = ctx.request.body || {};
      if (!name) { ctx.status = 400; ctx.body = { success: false, error: "缺少角色名称" }; return; }
      const role = await endpoint.createRole(ctx.params.guildId, name);
      ctx.body = { success: true, data: { id: role.role_id, name: role.name } };
    } catch (e: unknown) {
      ctx.status = 500;
      ctx.body = { success: false, error: e instanceof Error ? e.message : "创建角色失败" };
    }
  });

  // 删除角色
  router.delete("/api/kook/endpoints/:name/guilds/:guildId/roles/:roleId", async (ctx: any) => {
    try {
      const endpoint: any = kook.endpoints.get(ctx.params.name);
      if (!endpoint) { ctx.status = 404; ctx.body = { success: false, error: "Endpoint 不存在" }; return; }
      if (!endpoint.$connected) { ctx.status = 400; ctx.body = { success: false, error: "Endpoint 未连接" }; return; }
      const success = await endpoint.deleteRole(ctx.params.guildId, ctx.params.roleId);
      ctx.body = { success, message: success ? "角色已删除" : "删除失败" };
    } catch (e: unknown) {
      ctx.status = 500;
      ctx.body = { success: false, error: e instanceof Error ? e.message : "删除角色失败" };
    }
  });
});
