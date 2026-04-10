/**
 * ICQQ 适配器入口：类型扩展、导出、注册
 */
import path from "path";
import { usePlugin, type Plugin, type IGroupManagement, createGroupManagementTools, type ToolFeature } from "zhin.js";
import type { Router } from "@zhin.js/http";
import { MessageCommand } from "zhin.js";
import { IcqqAdapter } from "./adapter.js";
import type { WebServer } from "@zhin.js/console";

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

useContext("icqq", (icqq: IcqqAdapter) => {
  addCommand(
    new MessageCommand<"icqq">("赞我 <times:number>")
      .permit("adapter(icqq)")
      .action(async (message, result) => {
        const bot = icqq.bots.get(message.$bot);
        const send1 = bot?.sendLike(Number(message.$sender.id), 20);
        const send2 = bot?.sendLike(Number(message.$sender.id), 20);
        const send3 = bot?.sendLike(Number(message.$sender.id), 10);
        const [send1Result, send2Result, send3Result] = await Promise.all([send1, send2, send3]);
        let times = 0;
        if (send1Result) times += 20;
        if (send2Result) times += 20;
        if (send3Result) times += 10;
        return `给你赞好啦，你已经获得了${times}个赞`;
      }),
  );
});

useContext("tool", "icqq", (toolService: ToolFeature, icqq: IcqqAdapter) => {
  const groupTools = createGroupManagementTools(
    icqq,
    "icqq",
  );
  const disposers: (() => void)[] = groupTools.map(t => toolService.addTool(t, plugin.name));

  // 设置头衔
  disposers.push(toolService.addTool({
    name: "icqq_set_title",
    description: "设置 QQ 群成员的专属头衔",
    parameters: {
      type: "object",
      properties: {
        bot: { type: "string", description: "Bot QQ号" },
        group_id: { type: "number", description: "目标群号" },
        user_id: { type: "number", description: "目标成员 QQ号" },
        title: { type: "string", description: "头衔文字" },
        duration: { type: "number", description: "持续时间(秒)，-1永久" },
      },
      required: ["bot", "group_id", "user_id", "title"],
    },
    platforms: ["icqq"],
    tags: ["icqq"],
    execute: async (args: Record<string, any>) => {
      const bot = icqq.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      const success = await bot.setTitle(args.group_id, args.user_id, args.title, args.duration ?? -1);
      return { success, message: success ? `已将 ${args.user_id} 的头衔设为 "${args.title}"` : "设置失败" };
    },
  }, plugin.name));

  // 发送群公告
  disposers.push(toolService.addTool({
    name: "icqq_announce",
    description: "发送 QQ 群公告（需要管理员权限）",
    parameters: {
      type: "object",
      properties: {
        bot: { type: "string", description: "Bot QQ号" },
        group_id: { type: "number", description: "目标群号" },
        content: { type: "string", description: "公告内容" },
      },
      required: ["bot", "group_id", "content"],
    },
    platforms: ["icqq"],
    tags: ["icqq"],
    execute: async (args: Record<string, any>) => {
      const bot = icqq.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      const success = await bot.sendAnnounce(args.group_id, args.content);
      return { success, message: success ? "群公告已发送" : "发送失败" };
    },
  }, plugin.name));

  // 戳一戳
  disposers.push(toolService.addTool({
    name: "icqq_poke",
    description: "在 QQ 群中对某个成员执行戳一戳互动操作",
    parameters: {
      type: "object",
      properties: {
        bot: { type: "string", description: "Bot QQ号" },
        group_id: { type: "number", description: "目标群号" },
        user_id: { type: "number", description: "要戳的目标成员 QQ号" },
      },
      required: ["bot", "group_id", "user_id"],
    },
    platforms: ["icqq"],
    tags: ["icqq"],
    execute: async (args: Record<string, any>) => {
      const bot = icqq.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      const success = await bot.pokeMember(args.group_id, args.user_id);
      return { success, message: success ? `已戳了戳 ${args.user_id}` : "戳一戳失败" };
    },
  }, plugin.name));

  // 获取被禁言列表
  disposers.push(toolService.addTool({
    name: "icqq_list_muted",
    description: "查询 QQ 群中当前被禁言的成员列表",
    parameters: {
      type: "object",
      properties: {
        bot: { type: "string", description: "Bot QQ号" },
        group_id: { type: "number", description: "目标群号" },
      },
      required: ["bot", "group_id"],
    },
    platforms: ["icqq"],
    tags: ["icqq"],
    execute: async (args: Record<string, any>) => {
      const bot = icqq.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      const mutedList = await bot.getMutedMembers(args.group_id);
      const filtered = mutedList.filter((m: any) => m !== null);
      return { muted_members: filtered, count: filtered.length };
    },
  }, plugin.name));

  // 给用户点赞
  disposers.push(toolService.addTool({
    name: "icqq_send_user_like",
    description: "给用户点赞（竖大拇指），每人每天最多 20 次",
    parameters: {
      type: "object",
      properties: {
        bot: { type: "string", description: "Bot QQ号" },
        user_id: { type: "number", description: "要点赞的目标用户 QQ号" },
        times: { type: "number", description: "点赞次数（1-20），默认 1" },
      },
      required: ["bot", "user_id"],
    },
    platforms: ["icqq"],
    tags: ["icqq"],
    execute: async (args: Record<string, any>) => {
      const bot = icqq.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      const success = await bot.sendLike(args.user_id, Math.min(args.times ?? 1, 20));
      return { success, message: success ? `已给 ${args.user_id} 点赞` : "发送失败" };
    },
  }, plugin.name));

  // 设置匿名聊天
  disposers.push(toolService.addTool({
    name: "icqq_set_anonymous",
    description: "开启或关闭 QQ 群的匿名聊天功能",
    parameters: {
      type: "object",
      properties: {
        bot: { type: "string", description: "Bot QQ号" },
        group_id: { type: "number", description: "目标群号" },
        enable: { type: "boolean", description: "true=开启，false=关闭，默认 true" },
      },
      required: ["bot", "group_id"],
    },
    platforms: ["icqq"],
    tags: ["icqq"],
    execute: async (args: Record<string, any>) => {
      const bot = icqq.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      const enable = args.enable ?? true;
      const success = await bot.setAnonymous(args.group_id, enable);
      return { success, message: success ? (enable ? "已开启匿名聊天" : "已关闭匿名聊天") : "操作失败" };
    },
  }, plugin.name));

  // 群文件列表
  disposers.push(toolService.addTool({
    name: "icqq_group_files",
    description: "获取 QQ 群的群文件列表",
    parameters: {
      type: "object",
      properties: {
        bot: { type: "string", description: "Bot 名称" },
        group_id: { type: "number", description: "群号" },
      },
      required: ["bot", "group_id"],
    },
    platforms: ["icqq"],
    tags: ["icqq"],
    execute: async (args: Record<string, any>) => {
      const bot = icqq.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      const files = await bot.getGroupFiles(args.group_id);
      if (!files?.length) return { files: [], message: "群文件为空" };
      return {
        files: files.slice(0, 30).map((f: any) => ({
          name: f.name,
          size: f.size,
          uploader: f.uploader_uin,
          upload_time: f.upload_time,
        })),
        count: files.length,
      };
    },
  }, plugin.name));

  // 好友列表
  disposers.push(toolService.addTool({
    name: "icqq_friend_list",
    description: "获取 QQ 好友列表",
    parameters: {
      type: "object",
      properties: {
        bot: { type: "string", description: "Bot 名称" },
      },
      required: ["bot"],
    },
    platforms: ["icqq"],
    tags: ["icqq"],
    execute: async (args: Record<string, any>) => {
      const bot = icqq.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      const fl = bot.fl;
      const friends = Array.from(fl.values()).map((f: any) => ({
        user_id: f.user_id,
        nickname: f.nickname,
        remark: f.remark,
      }));
      return { friends: friends.slice(0, 50), count: fl.size };
    },
  }, plugin.name));

  return () => disposers.forEach(d => d());
});

useContext("web", (web: WebServer) => {
  const dispose = web.addEntry(
    path.resolve(import.meta.dirname, "../client/index.tsx"),
  );
  return dispose;
});

useContext("router", "icqq", async (router: Router, icqq: IcqqAdapter) => {
  const loginAssist = root.inject("loginAssist" as any) as
    | {
        listPending: () => unknown[];
        submit: (id: string, value: string | Record<string, unknown>) => boolean;
        cancel: (id: string, reason?: string) => boolean;
      }
    | undefined;
  if (loginAssist) {
    router.get("/api/login-assist/pending", (ctx: any) => {
      ctx.body = loginAssist.listPending();
    });
    router.post("/api/login-assist/submit", async (ctx: any) => {
      const body = ctx.request?.body as { id: string; value?: string | Record<string, unknown> };
      if (!body?.id) {
        ctx.status = 400;
        ctx.body = { error: "missing id" };
        return;
      }
      const ok = loginAssist.submit(body.id, body.value ?? "");
      ctx.body = { ok };
    });
    router.post("/api/login-assist/cancel", async (ctx: any) => {
      const body = ctx.request?.body as { id: string; reason?: string };
      if (!body?.id) {
        ctx.status = 400;
        ctx.body = { error: "missing id" };
        return;
      }
      const ok = loginAssist.cancel(body.id, body.reason);
      ctx.body = { ok };
    });
  }

  router.get("/api/icqq/bots", async (ctx) => {
    try {
      const bots = Array.from(icqq.bots.values());
      if (bots.length === 0) {
        ctx.body = { success: true, data: [], message: "暂无ICQQ机器人实例" };
        return;
      }
      const result = bots.map((bot) => {
        try {
          return {
            name: bot.$config.name,
            connected: bot.$connected || false,
            groupCount: bot.gl?.size || 0,
            friendCount: bot.fl?.size || 0,
            receiveCount: bot.stat?.recv_msg_cnt || 0,
            sendCount: bot.stat?.sent_msg_cnt || 0,
            loginMode: bot.$config.password ? "password" : "qrcode",
            status: bot.$connected ? "online" : "offline",
            lastActivity: new Date().toISOString(),
          };
        } catch {
          return {
            name: bot.$config.name,
            connected: false,
            groupCount: 0,
            friendCount: 0,
            receiveCount: 0,
            sendCount: 0,
            loginMode: "unknown",
            status: "error",
            error: "数据获取失败",
          };
        }
      });
      ctx.body = { success: true, data: result, timestamp: new Date().toISOString() };
    } catch (error) {
      ctx.status = 500;
      ctx.body = {
        success: false,
        error: "ICQQ_API_ERROR",
        message: "获取机器人数据失败",
        details: process.env.NODE_ENV === "development" ? (error as Error).message : undefined,
        timestamp: new Date().toISOString(),
      };
    }
  });
});
