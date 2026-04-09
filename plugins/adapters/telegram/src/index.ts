/**
 * Telegram 适配器入口：类型扩展、导出、注册
 */
import path from "node:path";
import { usePlugin, type Plugin, type Context, type IGroupManagement, createGroupManagementTools, type ToolFeature } from "zhin.js";
import { TelegramAdapter } from "./adapter.js";
import type { WebServer } from "@zhin.js/console";

declare module "zhin.js" {
  namespace Plugin {
    interface Contexts {
      web: WebServer;
    }
  }
}

declare module "zhin.js" {
  interface Adapters {
    telegram: TelegramAdapter;
  }
}

export * from "./types.js";
export { TelegramBot } from "./bot.js";
export { TelegramAdapter } from "./adapter.js";

const plugin = usePlugin();
const { provide, useContext } = plugin;

provide({
  name: "telegram",
  description: "Telegram Bot Adapter",
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
  const groupTools = createGroupManagementTools(
    telegram as unknown as IGroupManagement,
    'telegram',
  );
  const disposers: (() => void)[] = groupTools.map(t => toolService.addTool(t, 'telegram'));

  disposers.push(toolService.addTool({
    name: 'telegram_pin_message',
    description: '置顶 Telegram 群组消息',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
        chat_id: { type: 'string', description: '聊天 ID' },
        message_id: { type: 'string', description: '消息 ID' },
      },
      required: ['bot', 'chat_id', 'message_id'],
    },
    platforms: ['telegram'],
    tags: ['telegram'],
    execute: async (args: Record<string, any>) => {
      const bot = telegram.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      const success = await bot.pinMessage(Number(args.chat_id), Number(args.message_id));
      return { success, message: success ? '消息已置顶' : '操作失败' };
    },
  }, 'telegram'));

  disposers.push(toolService.addTool({
    name: 'telegram_unpin_message',
    description: '取消置顶 Telegram 群组消息',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
        chat_id: { type: 'string', description: '聊天 ID' },
        message_id: { type: 'string', description: '消息 ID（可选，不提供则取消所有置顶）' },
      },
      required: ['bot', 'chat_id'],
    },
    platforms: ['telegram'],
    tags: ['telegram'],
    execute: async (args: Record<string, any>) => {
      const bot = telegram.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      const success = await bot.unpinMessage(Number(args.chat_id), args.message_id ? Number(args.message_id) : undefined);
      return { success, message: success ? '已取消置顶' : '操作失败' };
    },
  }, 'telegram'));

  disposers.push(toolService.addTool({
    name: 'telegram_list_admins',
    description: '获取 Telegram 群组管理员列表',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
        chat_id: { type: 'string', description: '聊天 ID' },
      },
      required: ['bot', 'chat_id'],
    },
    platforms: ['telegram'],
    tags: ['telegram'],
    execute: async (args: Record<string, any>) => {
      const bot = telegram.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      const admins = await bot.getChatAdmins(Number(args.chat_id));
      return {
        admins: admins.map((a: any) => ({
          user_id: a.user.id,
          username: a.user.username,
          first_name: a.user.first_name,
          status: a.status,
        })),
        count: admins.length,
      };
    },
  }, 'telegram'));

  disposers.push(toolService.addTool({
    name: 'telegram_member_count',
    description: '获取 Telegram 群组成员数量',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
        chat_id: { type: 'string', description: '聊天 ID' },
      },
      required: ['bot', 'chat_id'],
    },
    platforms: ['telegram'],
    tags: ['telegram'],
    execute: async (args: Record<string, any>) => {
      const bot = telegram.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      const count = await bot.getChatMemberCount(Number(args.chat_id));
      return { count, message: `群组共有 ${count} 名成员` };
    },
  }, 'telegram'));

  disposers.push(toolService.addTool({
    name: 'telegram_create_invite',
    description: '创建 Telegram 群组邀请链接',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
        chat_id: { type: 'string', description: '聊天 ID' },
      },
      required: ['bot', 'chat_id'],
    },
    platforms: ['telegram'],
    tags: ['telegram'],
    execute: async (args: Record<string, any>) => {
      const bot = telegram.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      const link = await bot.createInviteLink(Number(args.chat_id));
      return { invite_link: link, message: `邀请链接: ${link}` };
    },
  }, 'telegram'));

  disposers.push(toolService.addTool({
    name: 'telegram_send_poll',
    description: '在 Telegram 群组中发起投票',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
        chat_id: { type: 'string', description: '聊天 ID' },
        question: { type: 'string', description: '投票问题' },
        options: { type: 'string', description: '选项 JSON 数组，如 ["A","B","C"]' },
        is_anonymous: { type: 'boolean', description: '是否匿名投票，默认 true' },
        allows_multiple: { type: 'boolean', description: '是否允许多选，默认 false' },
      },
      required: ['bot', 'chat_id', 'question', 'options'],
    },
    platforms: ['telegram'],
    tags: ['telegram'],
    execute: async (args: Record<string, any>) => {
      const bot = telegram.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      let optList: string[];
      try {
        optList = JSON.parse(args.options);
      } catch {
        return { success: false, message: 'options 格式错误，应为 JSON 数组' };
      }
      if (!Array.isArray(optList) || optList.length < 2) {
        return { success: false, message: '至少需要 2 个选项' };
      }
      const result = await bot.sendPoll(
        Number(args.chat_id), args.question, optList,
        args.is_anonymous ?? true, args.allows_multiple ?? false,
      );
      return { success: true, message_id: result.message_id, message: '投票已发送' };
    },
  }, 'telegram'));

  disposers.push(toolService.addTool({
    name: 'telegram_react',
    description: '对 Telegram 消息添加表情反应',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
        chat_id: { type: 'string', description: '聊天 ID' },
        message_id: { type: 'string', description: '消息 ID' },
        reaction: { type: 'string', description: '反应表情（如 👍、❤️、🔥）' },
      },
      required: ['bot', 'chat_id', 'message_id', 'reaction'],
    },
    platforms: ['telegram'],
    tags: ['telegram'],
    execute: async (args: Record<string, any>) => {
      const bot = telegram.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      const success = await bot.setMessageReaction(Number(args.chat_id), Number(args.message_id), args.reaction);
      return { success, message: success ? `已添加反应 ${args.reaction}` : '操作失败' };
    },
  }, 'telegram'));

  disposers.push(toolService.addTool({
    name: 'telegram_send_sticker',
    description: '发送 Telegram 贴纸',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
        chat_id: { type: 'string', description: '聊天 ID' },
        sticker: { type: 'string', description: '贴纸 file_id 或 URL' },
      },
      required: ['bot', 'chat_id', 'sticker'],
    },
    platforms: ['telegram'],
    tags: ['telegram'],
    execute: async (args: Record<string, any>) => {
      const bot = telegram.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      const result = await bot.sendStickerMessage(Number(args.chat_id), args.sticker);
      return { success: true, message_id: result.message_id, message: '贴纸已发送' };
    },
  }, 'telegram'));

  disposers.push(toolService.addTool({
    name: 'telegram_set_permissions',
    description: '设置 Telegram 群组的默认成员权限',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
        chat_id: { type: 'string', description: '聊天 ID' },
        can_send_messages: { type: 'boolean', description: '是否可以发消息' },
        can_send_photos: { type: 'boolean', description: '是否可以发图片' },
        can_send_videos: { type: 'boolean', description: '是否可以发视频' },
        can_send_polls: { type: 'boolean', description: '是否可以发投票' },
        can_send_other_messages: { type: 'boolean', description: '是否可以发贴纸/GIF等' },
        can_add_web_page_previews: { type: 'boolean', description: '是否可以添加网页预览' },
        can_change_info: { type: 'boolean', description: '是否可以改群信息' },
        can_invite_users: { type: 'boolean', description: '是否可以邀请用户' },
        can_pin_messages: { type: 'boolean', description: '是否可以置顶消息' },
      },
      required: ['bot', 'chat_id'],
    },
    platforms: ['telegram'],
    tags: ['telegram'],
    execute: async (args: Record<string, any>) => {
      const { bot: botId, chat_id, ...perms } = args;
      const bot = telegram.bots.get(botId);
      if (!bot) throw new Error(`Bot ${botId} 不存在`);
      const permissions: any = {};
      for (const [k, v] of Object.entries(perms)) {
        if (typeof v === 'boolean') permissions[k] = v;
      }
      const success = await bot.setChatPermissionsAll(Number(chat_id), permissions);
      return { success, message: success ? '群权限已更新' : '操作失败' };
    },
  }, 'telegram'));

  disposers.push(toolService.addTool({
    name: 'telegram_set_description',
    description: '设置 Telegram 群组描述',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
        chat_id: { type: 'string', description: '聊天 ID' },
        description: { type: 'string', description: '群描述文字' },
      },
      required: ['bot', 'chat_id', 'description'],
    },
    platforms: ['telegram'],
    tags: ['telegram'],
    execute: async (args: Record<string, any>) => {
      const bot = telegram.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      const success = await bot.setChatDescription(Number(args.chat_id), args.description);
      return { success, message: success ? '群描述已更新' : '操作失败' };
    },
  }, 'telegram'));

  return () => disposers.forEach(d => d());
});

// ── Web 控制台 ─────────────────────────────────────────────────────────
useContext("web", (web: WebServer) => {
  return web.addEntry(path.resolve(import.meta.dirname, "../client/index.tsx"));
});

useContext("router", "telegram", (router: any, telegram: TelegramAdapter) => {
  router.get("/api/telegram/bots", async (ctx: any) => {
    try {
      const bots = Array.from(telegram.bots.values());
      const result = bots.map((bot: any) => {
        try {
          return {
            name: bot.$config.name,
            connected: bot.$connected || false,
            mode: bot.$config.polling !== false ? "polling" : "webhook",
            status: bot.$connected ? "online" : "offline",
            botInfo: bot.botInfo ? { username: bot.botInfo.username, firstName: bot.botInfo.first_name } : null,
          };
        } catch {
          return { name: bot.$config.name, connected: false, mode: "unknown", status: "error", botInfo: null };
        }
      });
      ctx.body = { success: true, data: result };
    } catch {
      ctx.status = 500;
      ctx.body = { success: false, error: "获取机器人数据失败" };
    }
  });

  // Bot 连接/断开
  router.post("/api/telegram/bots/:name/connect", async (ctx: any) => {
    try {
      const bot = telegram.bots.get(ctx.params.name);
      if (!bot) { ctx.status = 404; ctx.body = { success: false, error: "Bot 不存在" }; return; }
      if (bot.$connected) { ctx.body = { success: true, message: "已经在线" }; return; }
      await bot.$connect();
      ctx.body = { success: true, message: "连接成功" };
    } catch (e: any) {
      ctx.status = 500;
      ctx.body = { success: false, error: e?.message || "连接失败" };
    }
  });

  router.post("/api/telegram/bots/:name/disconnect", async (ctx: any) => {
    try {
      const bot = telegram.bots.get(ctx.params.name);
      if (!bot) { ctx.status = 404; ctx.body = { success: false, error: "Bot 不存在" }; return; }
      if (!bot.$connected) { ctx.body = { success: true, message: "已经离线" }; return; }
      await bot.$disconnect();
      ctx.body = { success: true, message: "已断开" };
    } catch (e: any) {
      ctx.status = 500;
      ctx.body = { success: false, error: e?.message || "断开失败" };
    }
  });

  // 快捷操作：创建邀请链接
  router.post("/api/telegram/bots/:name/invite", async (ctx: any) => {
    try {
      const bot: any = telegram.bots.get(ctx.params.name);
      if (!bot) { ctx.status = 404; ctx.body = { success: false, error: "Bot 不存在" }; return; }
      if (!bot.$connected) { ctx.status = 400; ctx.body = { success: false, error: "Bot 未连接" }; return; }
      const { chat_id } = ctx.request.body || {};
      if (!chat_id) { ctx.status = 400; ctx.body = { success: false, error: "缺少 chat_id" }; return; }
      const link = await bot.createInviteLink(Number(chat_id));
      ctx.body = { success: true, data: { invite_link: link } };
    } catch (e: any) {
      ctx.status = 500;
      ctx.body = { success: false, error: e?.message || "创建邀请链接失败" };
    }
  });

  // 快捷操作：发起投票
  router.post("/api/telegram/bots/:name/poll", async (ctx: any) => {
    try {
      const bot: any = telegram.bots.get(ctx.params.name);
      if (!bot) { ctx.status = 404; ctx.body = { success: false, error: "Bot 不存在" }; return; }
      if (!bot.$connected) { ctx.status = 400; ctx.body = { success: false, error: "Bot 未连接" }; return; }
      const { chat_id, question, options, is_anonymous, allows_multiple } = ctx.request.body || {};
      if (!chat_id || !question || !options?.length) {
        ctx.status = 400; ctx.body = { success: false, error: "缺少 chat_id, question 或 options" }; return;
      }
      if (options.length < 2) { ctx.status = 400; ctx.body = { success: false, error: "至少需要 2 个选项" }; return; }
      const result = await bot.sendPoll(Number(chat_id), question, options, is_anonymous ?? true, allows_multiple ?? false);
      ctx.body = { success: true, data: { message_id: result.message_id } };
    } catch (e: any) {
      ctx.status = 500;
      ctx.body = { success: false, error: e?.message || "发起投票失败" };
    }
  });

  // 快捷操作：获取群管理员
  router.get("/api/telegram/bots/:name/admins", async (ctx: any) => {
    try {
      const bot: any = telegram.bots.get(ctx.params.name);
      if (!bot) { ctx.status = 404; ctx.body = { success: false, error: "Bot 不存在" }; return; }
      if (!bot.$connected) { ctx.status = 400; ctx.body = { success: false, error: "Bot 未连接" }; return; }
      const chat_id = ctx.query.chat_id;
      if (!chat_id) { ctx.status = 400; ctx.body = { success: false, error: "缺少 chat_id" }; return; }
      const admins = await bot.getChatAdmins(Number(chat_id));
      ctx.body = {
        success: true,
        data: admins.map((a: any) => ({
          user_id: a.user.id,
          username: a.user.username,
          first_name: a.user.first_name,
          status: a.status,
        })),
      };
    } catch (e: any) {
      ctx.status = 500;
      ctx.body = { success: false, error: e?.message || "获取管理员失败" };
    }
  });
});
