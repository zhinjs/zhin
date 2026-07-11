/**
 * Discord 适配器入口：单一适配器，支持 Gateway / Interactions（connection: gateway | interactions）
 */
import path from "node:path";
import { usePlugin, type Plugin, type Context, type ISceneManagement, createSceneManagementTools, type ToolFeature } from "zhin.js";
import type { Router } from "@zhin.js/host-router";
import { PageManager } from "@zhin.js/host-api";
import { DiscordAdapter } from "./adapter.js";
import {
  discordGroupPermitResolver,
  registerDiscordPlatformPermitChecker,
} from "./platform-permit.js";
import { setDiscordAgentDeps } from "./discord-agent-deps.js";

declare module "zhin.js" {
  namespace Plugin {
    interface Contexts {
      router: import("@zhin.js/host-router").Router;
      web: PageManager;
    }
  }
  interface Adapters {
    discord: DiscordAdapter;
  }
}

export * from "./types.js";
export { DiscordEndpoint } from "./endpoint.js";
export { DiscordInteractionsEndpoint } from "./endpoint-interactions.js";
export { DiscordAdapter, type DiscordEndpointLike } from "./adapter.js";

const plugin = usePlugin();
const { provide, useContext } = plugin;
provide({
  name: "discord",
  description: "Discord 适配器（Gateway / Interactions）",
  mounted: async (p: Plugin) => {
    const adapter = new DiscordAdapter(p);
    await adapter.start();
    return adapter;
  },
  dispose: async (adapter: DiscordAdapter) => {
    await adapter.stop();
  },
});

useContext('tool', 'discord', (toolService: ToolFeature, discord: DiscordAdapter) => {
  const disposers: (() => void)[] = [];
  disposers.push(registerDiscordPlatformPermitChecker());
  setDiscordAgentDeps({
    getEndpoint: (endpointId) => {
      const endpoint = discord.endpoints.get(endpointId);
      if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
      return endpoint;
    },
    getGatewayEndpoint: (endpointId) => {
      const endpoint = discord.endpoints.get(endpointId);
      if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
      if ((endpoint.$config as { connection?: string }).connection !== 'gateway') {
        throw new Error('此工具仅支持 connection: gateway');
      }
      return endpoint;
    },
    getAdapter: () => discord,
  });
  const sceneTools = createSceneManagementTools(
    discord as unknown as ISceneManagement,
    'discord',
    { permitResolver: discordGroupPermitResolver, registerChecker: false },
  );
  disposers.push(...sceneTools.map(t => toolService.addTool(t, plugin.name)));

  return () => disposers.forEach(d => d());
});

// ── Web 控制台 ─────────────────────────────────────────────────────────
useContext("web", (pageManager) => {
  pageManager.addEntry({
    id: "discord",
    development: path.resolve(import.meta.dirname, "../client/index.tsx"),
    production: path.resolve(import.meta.dirname, "../dist/index.js"),
    meta: { name: "Discord" },
  });
});

useContext("router", "discord", (router: Router, discord: DiscordAdapter) => {
  router.get("/api/discord/endpoints", async (ctx: any) => {
    try {
      const endpoints = Array.from(discord.endpoints.values());
      const result = endpoints.map((endpoint: any) => {
        try {
          const client = endpoint.client || endpoint;
          return {
            name: endpoint.$config.name,
            connected: endpoint.$connected || false,
            mode: endpoint.$config.connection || "gateway",
            guildCount: client.guilds?.cache?.size || 0,
            channelCount: client.channels?.cache?.size || 0,
            status: endpoint.$connected ? "online" : "offline",
            user: client.user ? { tag: client.user.tag, id: client.user.id } : null,
          };
        } catch {
          return { name: endpoint.$config.name, connected: false, mode: "unknown", guildCount: 0, channelCount: 0, status: "error", user: null };
        }
      });
      ctx.body = { success: true, data: result };
    } catch {
      ctx.status = 500;
      ctx.body = { success: false, error: "获取 Endpoint 数据失败" };
    }
  });

  // Endpoint 连接/断开
  router.post("/api/discord/endpoints/:name/connect", async (ctx: any) => {
    try {
      const endpoint = discord.endpoints.get(ctx.params.name);
      if (!endpoint) { ctx.status = 404; ctx.body = { success: false, error: "Endpoint 不存在" }; return; }
      if (endpoint.$connected) { ctx.body = { success: true, message: "已经在线" }; return; }
      await endpoint.$connect();
      ctx.body = { success: true, message: "连接成功" };
    } catch (e: unknown) {
      ctx.status = 500;
      ctx.body = { success: false, error: e instanceof Error ? e.message : "连接失败" };
    }
  });

  router.post("/api/discord/endpoints/:name/disconnect", async (ctx: any) => {
    try {
      const endpoint = discord.endpoints.get(ctx.params.name);
      if (!endpoint) { ctx.status = 404; ctx.body = { success: false, error: "Endpoint 不存在" }; return; }
      if (!endpoint.$connected) { ctx.body = { success: true, message: "已经离线" }; return; }
      await endpoint.$disconnect();
      ctx.body = { success: true, message: "已断开" };
    } catch (e: unknown) {
      ctx.status = 500;
      ctx.body = { success: false, error: e instanceof Error ? e.message : "断开失败" };
    }
  });

  // 服务器列表（仅 Gateway 模式）
  router.get("/api/discord/endpoints/:name/guilds", async (ctx: any) => {
    try {
      const endpoint: any = discord.endpoints.get(ctx.params.name);
      if (!endpoint) { ctx.status = 404; ctx.body = { success: false, error: "Endpoint 不存在" }; return; }
      if (!endpoint.$connected) { ctx.status = 400; ctx.body = { success: false, error: "Endpoint 未连接" }; return; }
      const client = endpoint.client || endpoint;
      const guilds = client.guilds?.cache?.map((g: any) => ({
        id: g.id,
        name: g.name,
        memberCount: g.memberCount,
        icon: g.iconURL({ size: 64 }),
      })) || [];
      ctx.body = { success: true, data: guilds };
    } catch (e: unknown) {
      ctx.status = 500;
      ctx.body = { success: false, error: e instanceof Error ? e.message : "获取服务器列表失败" };
    }
  });
});
