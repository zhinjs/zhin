/**
 * Telegram 适配器入口：类型扩展、导出、注册
 */
import path from "node:path";
import { usePlugin, type Plugin, type Context, type ISceneManagement, createSceneManagementTools, type ToolFeature } from "zhin.js";
import { TelegramAdapter } from "./adapter.js";
import { PageManager } from "@zhin.js/host-api";
import {
  registerTelegramPlatformPermitChecker,
  telegramGroupPermitResolver,
} from "./platform-permit.js";
import { setTelegramAgentDeps } from "./telegram-agent-deps.js";

declare module "zhin.js" {
  namespace Plugin {
    interface Contexts {
      web: PageManager;
    }
  }
}

declare module "zhin.js" {
  interface Adapters {
    telegram: TelegramAdapter;
  }
}

export * from "./types.js";
export { TelegramEndpoint } from "./endpoint.js";
export { TelegramAdapter } from "./adapter.js";

const plugin = usePlugin();
const { provide, useContext } = plugin;

provide({
  name: "telegram",
  description: "Telegram Endpoint Adapter",
  mounted: async (p: Plugin) => {
    const adapter = new TelegramAdapter(p);
    await adapter.start();
    return adapter;
  },
  dispose: async (adapter: TelegramAdapter) => {
    await adapter.stop();
  },
} as Context<"telegram">);

useContext('tool', 'telegram', (toolService: ToolFeature, telegram: TelegramAdapter) => {
  const disposers: (() => void)[] = [];
  disposers.push(registerTelegramPlatformPermitChecker());
  setTelegramAgentDeps({
    getEndpoint: (endpointId) => {
      const endpoint = telegram.endpoints.get(endpointId);
      if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
      return endpoint;
    },
    getAdapter: () => telegram,
  });
  const sceneTools = createSceneManagementTools(
    telegram as unknown as ISceneManagement,
    'telegram',
    { permitResolver: telegramGroupPermitResolver, registerChecker: false },
  );
  disposers.push(...sceneTools.map(t => toolService.addTool(t, plugin.name)));

  return () => disposers.forEach(d => d());
});

// ── Web 控制台 ─────────────────────────────────────────────────────────
useContext("web", (pageManager) => {
  pageManager.addEntry({
    id: "telegram",
    development: path.resolve(import.meta.dirname, "../client/index.tsx"),
    production: path.resolve(import.meta.dirname, "../dist/index.js"),
    meta: { name: "Telegram" },
  });
});

useContext("router", "telegram", (router: any, telegram: TelegramAdapter) => {
  router.get("/api/telegram/endpoints", async (ctx: any) => {
    try {
      const endpoints = Array.from(telegram.endpoints.values());
      const result = endpoints.map((endpoint: any) => {
        try {
          return {
            name: endpoint.$config.name,
            connected: endpoint.$connected || false,
            mode: endpoint.$config.polling !== false ? "polling" : "webhook",
            status: endpoint.$connected ? "online" : "offline",
            botInfo: endpoint.botInfo ? { username: endpoint.botInfo.username, firstName: endpoint.botInfo.first_name } : null,
          };
        } catch {
          return { name: endpoint.$config.name, connected: false, mode: "unknown", status: "error", botInfo: null };
        }
      });
      ctx.body = { success: true, data: result };
    } catch {
      ctx.status = 500;
      ctx.body = { success: false, error: "获取 Endpoint 数据失败" };
    }
  });

  // Endpoint 连接/断开
  router.post("/api/telegram/endpoints/:name/connect", async (ctx: any) => {
    try {
      const endpoint = telegram.endpoints.get(ctx.params.name);
      if (!endpoint) { ctx.status = 404; ctx.body = { success: false, error: "Endpoint 不存在" }; return; }
      if (endpoint.$connected) { ctx.body = { success: true, message: "已经在线" }; return; }
      await endpoint.$connect();
      ctx.body = { success: true, message: "连接成功" };
    } catch (e: unknown) {
      ctx.status = 500;
      ctx.body = { success: false, error: e instanceof Error ? e.message : "连接失败" };
    }
  });

  router.post("/api/telegram/endpoints/:name/disconnect", async (ctx: any) => {
    try {
      const endpoint = telegram.endpoints.get(ctx.params.name);
      if (!endpoint) { ctx.status = 404; ctx.body = { success: false, error: "Endpoint 不存在" }; return; }
      if (!endpoint.$connected) { ctx.body = { success: true, message: "已经离线" }; return; }
      await endpoint.$disconnect();
      ctx.body = { success: true, message: "已断开" };
    } catch (e: unknown) {
      ctx.status = 500;
      ctx.body = { success: false, error: e instanceof Error ? e.message : "断开失败" };
    }
  });

  // 快捷操作：创建邀请链接
  router.post("/api/telegram/endpoints/:name/invite", async (ctx: any) => {
    try {
      const endpoint: any = telegram.endpoints.get(ctx.params.name);
      if (!endpoint) { ctx.status = 404; ctx.body = { success: false, error: "Endpoint 不存在" }; return; }
      if (!endpoint.$connected) { ctx.status = 400; ctx.body = { success: false, error: "Endpoint 未连接" }; return; }
      const { chat_id } = ctx.request.body || {};
      if (!chat_id) { ctx.status = 400; ctx.body = { success: false, error: "缺少 chat_id" }; return; }
      const link = await endpoint.createInviteLink(Number(chat_id));
      ctx.body = { success: true, data: { invite_link: link } };
    } catch (e: unknown) {
      ctx.status = 500;
      ctx.body = { success: false, error: e instanceof Error ? e.message : "创建邀请链接失败" };
    }
  });

  // 快捷操作：发起投票
  router.post("/api/telegram/endpoints/:name/poll", async (ctx: any) => {
    try {
      const endpoint: any = telegram.endpoints.get(ctx.params.name);
      if (!endpoint) { ctx.status = 404; ctx.body = { success: false, error: "Endpoint 不存在" }; return; }
      if (!endpoint.$connected) { ctx.status = 400; ctx.body = { success: false, error: "Endpoint 未连接" }; return; }
      const { chat_id, question, options, is_anonymous, allows_multiple } = ctx.request.body || {};
      if (!chat_id || !question || !options?.length) {
        ctx.status = 400; ctx.body = { success: false, error: "缺少 chat_id, question 或 options" }; return;
      }
      if (options.length < 2) { ctx.status = 400; ctx.body = { success: false, error: "至少需要 2 个选项" }; return; }
      const result = await endpoint.sendPoll(Number(chat_id), question, options, is_anonymous ?? true, allows_multiple ?? false);
      ctx.body = { success: true, data: { message_id: result.message_id } };
    } catch (e: unknown) {
      ctx.status = 500;
      ctx.body = { success: false, error: e instanceof Error ? e.message : "发起投票失败" };
    }
  });

  // 快捷操作：获取群管理员
  router.get("/api/telegram/endpoints/:name/admins", async (ctx: any) => {
    try {
      const endpoint: any = telegram.endpoints.get(ctx.params.name);
      if (!endpoint) { ctx.status = 404; ctx.body = { success: false, error: "Endpoint 不存在" }; return; }
      if (!endpoint.$connected) { ctx.status = 400; ctx.body = { success: false, error: "Endpoint 未连接" }; return; }
      const chat_id = ctx.query.chat_id;
      if (!chat_id) { ctx.status = 400; ctx.body = { success: false, error: "缺少 chat_id" }; return; }
      const admins = await endpoint.getChatAdmins(Number(chat_id));
      ctx.body = {
        success: true,
        data: admins.map((a: any) => ({
          user_id: a.user.id,
          username: a.user.username,
          first_name: a.user.first_name,
          status: a.status,
        })),
      };
    } catch (e: unknown) {
      ctx.status = 500;
      ctx.body = { success: false, error: e instanceof Error ? e.message : "获取管理员失败" };
    }
  });
});
