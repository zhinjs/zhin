/**
 * QQ 官方适配器入口：类型扩展、导出、注册
 */
import path from "node:path";
import { usePlugin, type Plugin, type ISceneManagement, createSceneManagementTools, type ToolFeature } from "zhin.js";
import type { Router } from "@zhin.js/host-router";
import { QQAdapter } from "./adapter.js";
import { PageManager } from "@zhin.js/host-api";
import {
  qqGuildPermitResolver,
  registerQqPlatformPermitChecker,
} from "./platform-permit.js";
import { disposeQqEndpointProvision } from "./qq-endpoint-manager.js";
import { setQqAgentDeps } from "./qq-agent-deps.js";

declare module "zhin.js" {
  namespace Plugin {
    interface Contexts {
      web: PageManager;
      router: Router;
    }
  }
}

declare module "zhin.js" {
  interface Adapters {
    qq: QQAdapter;
  }
}

export * from "./types.js";
export { QQEndpoint } from "./endpoint.js";
export { QQAdapter } from "./adapter.js";
export { startQqBindFlow } from "./qq-bind-flow.js";
export * from "./qq-bind-api.js";
export { QqEndpointManager, disposeQqEndpointProvision } from "./qq-endpoint-manager.js";

const plugin = usePlugin();
const { provide, useContext, onDispose } = plugin;

useContext("router", (router: Router) => {
  provide({
    name: "qq",
    description: "QQ Official Endpoint Adapter",
    mounted: async (p: Plugin) => {
      const adapter = new QQAdapter(p, router);
      await adapter.start();
      return adapter;
    },
    dispose: async (adapter: QQAdapter) => {
      await adapter.stop();
    },
  });
});

useContext('tool', 'qq', (toolService: ToolFeature, qq: QQAdapter) => {
  const disposers: (() => void)[] = [];
  disposers.push(registerQqPlatformPermitChecker());
  setQqAgentDeps({
    getEndpoint: (endpointId) => {
      const endpoint = qq.endpoints.get(endpointId);
      if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
      return endpoint;
    },
    getAdapter: () => qq,
  });
  const sceneTools = createSceneManagementTools(
    qq as unknown as ISceneManagement,
    'qq',
    { permitResolver: qqGuildPermitResolver, registerChecker: false },
  );
  disposers.push(...sceneTools.map(t => toolService.addTool(t, plugin.name)));

  return () => disposers.forEach(d => d());
});

// ── Web 控制台 ─────────────────────────────────────────────────────────
useContext("web", (pageManager) => {
  pageManager.addEntry({
    id: "qq",
    development: path.resolve(import.meta.dirname, "../client/index.tsx"),
    production: path.resolve(import.meta.dirname, "../dist/index.js"),
    meta: { name: "QQ" },
  });
});

useContext("router", "qq", (router: any, qq: QQAdapter) => {
  router.get("/api/qq/endpoints", async (ctx: any) => {
    try {
      const endpoints = Array.from(qq.endpoints.values());
      const result = await Promise.all(endpoints.map(async (endpoint) => {
        try {
          let guildCount = 0;
          try { const guilds = await endpoint.getGuilds(); guildCount = guilds?.length || 0; } catch {}
          return {
            name: endpoint.$config.name,
            connected: endpoint.$connected || false,
            guildCount,
            status: endpoint.$connected ? "online" : "offline",
          };
        } catch {
          return { name: endpoint.$config.name, connected: false, guildCount: 0, status: "error" };
        }
      }));
      ctx.body = { success: true, data: result };
    } catch {
      ctx.status = 500;
      ctx.body = { success: false, error: "获取 Endpoint 数据失败" };
    }
  });

  // Endpoint 连接/断开
  router.post("/api/qq/endpoints/:name/connect", async (ctx: any) => {
    try {
      const endpoint = qq.endpoints.get(ctx.params.name);
      if (!endpoint) { ctx.status = 404; ctx.body = { success: false, error: "Endpoint 不存在" }; return; }
      if (endpoint.$connected) { ctx.body = { success: true, message: "已经在线" }; return; }
      await endpoint.$connect();
      ctx.body = { success: true, message: "连接成功" };
    } catch (e: unknown) {
      ctx.status = 500;
      ctx.body = { success: false, error: e instanceof Error ? e.message : "连接失败" };
    }
  });

  router.post("/api/qq/endpoints/:name/disconnect", async (ctx: any) => {
    try {
      const endpoint = qq.endpoints.get(ctx.params.name);
      if (!endpoint) { ctx.status = 404; ctx.body = { success: false, error: "Endpoint 不存在" }; return; }
      if (!endpoint.$connected) { ctx.body = { success: true, message: "已经离线" }; return; }
      await endpoint.$disconnect();
      ctx.body = { success: true, message: "已断开" };
    } catch (e: unknown) {
      ctx.status = 500;
      ctx.body = { success: false, error: e instanceof Error ? e.message : "断开失败" };
    }
  });

  // 频道列表（QQ 官方 API 返回 guild_id/guild_name，归一化为控制台用的 id/name）
  router.get("/api/qq/endpoints/:name/guilds", async (ctx: any) => {
    try {
      const endpoint = qq.endpoints.get(ctx.params.name);
      if (!endpoint) { ctx.status = 404; ctx.body = { success: false, error: "Endpoint 不存在" }; return; }
      if (!endpoint.$connected) { ctx.status = 400; ctx.body = { success: false, error: "Endpoint 未连接" }; return; }
      const raw = await endpoint.getGuilds();
      const guilds = (raw || []).map((g: any) => ({
        id: g.guild_id ?? g.id,
        name: g.guild_name ?? g.name,
        icon: g.icon,
        description: g.description,
        memberCount: g.member_count,
        ownerId: g.owner_id,
        owner: g.owner,
        joinTime: g.join_time,
      }));
      ctx.body = { success: true, data: guilds };
    } catch (e: unknown) {
      ctx.status = 500;
      ctx.body = { success: false, error: e instanceof Error ? e.message : "获取频道失败" };
    }
  });

  // 子频道列表（QQ 官方 API 返回 channel_id/channel_name，归一化为 id/name）
  router.get("/api/qq/endpoints/:name/guilds/:guildId/channels", async (ctx: any) => {
    try {
      const endpoint = qq.endpoints.get(ctx.params.name);
      if (!endpoint) { ctx.status = 404; ctx.body = { success: false, error: "Endpoint 不存在" }; return; }
      if (!endpoint.$connected) { ctx.status = 400; ctx.body = { success: false, error: "Endpoint 未连接" }; return; }
      const raw = await endpoint.getChannels(ctx.params.guildId);
      const channels = (raw || []).map((ch: any) => ({
        id: ch.channel_id ?? ch.id,
        name: ch.channel_name ?? ch.name,
        type: ch.type,
        subType: ch.sub_type,
        position: ch.position,
        parentId: ch.parent_id,
      }));
      ctx.body = { success: true, data: channels };
    } catch (e: unknown) {
      ctx.status = 500;
      ctx.body = { success: false, error: e instanceof Error ? e.message : "获取子频道失败" };
    }
  });
});

onDispose(() => {
  disposeQqEndpointProvision();
});
