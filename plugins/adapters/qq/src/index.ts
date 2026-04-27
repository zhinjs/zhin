/**
 * QQ 官方适配器入口：类型扩展、导出、注册
 */
import path from "node:path";
import { usePlugin, type Plugin, type IGroupManagement, createGroupManagementTools, type ToolFeature } from "zhin.js";
import { QQAdapter } from "./adapter.js";
import { PageManager } from "@zhin.js/console";

declare module "zhin.js" {
  namespace Plugin {
    interface Contexts {
      web: PageManager;
    }
  }
}

declare module "zhin.js" {
  interface Adapters {
    qq: QQAdapter;
  }
}

export * from "./types.js";
export { QQBot } from "./bot.js";
export { QQAdapter } from "./adapter.js";

const plugin = usePlugin();
const { provide, useContext } = plugin;

provide({
  name: "qq",
  description: "QQ Official Bot Adapter",
  mounted: async (p: Plugin) => {
    const adapter = new QQAdapter(p);
    await adapter.start();
    return adapter;
  },
  dispose: async (adapter: QQAdapter) => {
    await adapter.stop();
  },
});

useContext('tool', 'qq', (toolService: ToolFeature, qq: QQAdapter) => {
  const groupTools = createGroupManagementTools(
    qq as unknown as IGroupManagement,
    'qq',
  );
  const disposers: (() => void)[] = groupTools.map(t => toolService.addTool(t, plugin.name));

  // 获取频道列表
  disposers.push(toolService.addTool({
    name: 'qq_list_guilds',
    description: '获取 QQ 频道列表',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
      },
      required: ['bot'],
    },
    platforms: ['qq'],
    tags: ['qq'],
    execute: async (args: Record<string, any>) => {
      const bot = qq.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      const guilds = await bot.getGuilds();
      return { guilds, count: guilds.length };
    },
  }, plugin.name));

  // 获取子频道列表
  disposers.push(toolService.addTool({
    name: 'qq_list_channels',
    description: '获取 QQ 频道下的子频道列表',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
        guild_id: { type: 'string', description: '频道 ID' },
      },
      required: ['bot', 'guild_id'],
    },
    platforms: ['qq'],
    tags: ['qq'],
    execute: async (args: Record<string, any>) => {
      const bot = qq.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      const channels = await bot.getChannels(args.guild_id);
      return { channels, count: channels.length };
    },
  }, plugin.name));

  // 获取角色列表
  disposers.push(toolService.addTool({
    name: 'qq_list_roles',
    description: '获取 QQ 频道角色列表',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
        guild_id: { type: 'string', description: '频道 ID' },
      },
      required: ['bot', 'guild_id'],
    },
    platforms: ['qq'],
    tags: ['qq'],
    execute: async (args: Record<string, any>) => {
      const bot = qq.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      const roles = await bot.getGuildRoles(args.guild_id);
      return { roles, count: roles.length };
    },
  }, plugin.name));

  // 创建角色
  disposers.push(toolService.addTool({
    name: 'qq_create_role',
    description: '创建 QQ 频道角色',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
        guild_id: { type: 'string', description: '频道 ID' },
        name: { type: 'string', description: '角色名称' },
        color: { type: 'number', description: '颜色（RGB 十进制数值）' },
      },
      required: ['bot', 'guild_id', 'name'],
    },
    platforms: ['qq'],
    tags: ['qq'],
    execute: async (args: Record<string, any>) => {
      const bot = qq.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      const role = await bot.createGuildRole(args.guild_id, args.name, args.color);
      return { success: !!role, role, message: role ? `角色 "${args.name}" 创建成功` : '创建失败' };
    },
  }, plugin.name));

  // 添加角色
  disposers.push(toolService.addTool({
    name: 'qq_add_role',
    description: '给成员添加 QQ 频道角色',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
        guild_id: { type: 'string', description: '频道 ID' },
        channel_id: { type: 'string', description: '子频道 ID' },
        user_id: { type: 'string', description: '用户 ID' },
        role_id: { type: 'string', description: '角色 ID' },
      },
      required: ['bot', 'guild_id', 'channel_id', 'user_id', 'role_id'],
    },
    platforms: ['qq'],
    tags: ['qq'],
    execute: async (args: Record<string, any>) => {
      const bot = qq.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      const success = await bot.addMemberRole(args.guild_id, args.channel_id, args.user_id, args.role_id);
      return { success, message: success ? '已给成员添加角色' : '操作失败' };
    },
  }, plugin.name));

  // 移除角色
  disposers.push(toolService.addTool({
    name: 'qq_remove_role',
    description: '移除成员的 QQ 频道角色',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
        guild_id: { type: 'string', description: '频道 ID' },
        channel_id: { type: 'string', description: '子频道 ID' },
        user_id: { type: 'string', description: '用户 ID' },
        role_id: { type: 'string', description: '角色 ID' },
      },
      required: ['bot', 'guild_id', 'channel_id', 'user_id', 'role_id'],
    },
    platforms: ['qq'],
    tags: ['qq'],
    execute: async (args: Record<string, any>) => {
      const bot = qq.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      const success = await bot.removeMemberRole(args.guild_id, args.channel_id, args.user_id, args.role_id);
      return { success, message: success ? '已移除成员的角色' : '操作失败' };
    },
  }, plugin.name));

  // 子频道详情
  disposers.push(toolService.addTool({
    name: 'qq_channel_info',
    description: '获取 QQ 频道中指定子频道的详细信息',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
        channel_id: { type: 'string', description: '子频道 ID' },
      },
      required: ['bot', 'channel_id'],
    },
    platforms: ['qq'],
    tags: ['qq'],
    execute: async (args: Record<string, any>) => {
      const bot = qq.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      const info = await bot.getChannelInfo(args.channel_id);
      return info;
    },
  }, plugin.name));

  // 单成员详情
  disposers.push(toolService.addTool({
    name: 'qq_member_detail',
    description: '获取 QQ 频道中指定成员的详细信息',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
        guild_id: { type: 'string', description: '频道 ID' },
        user_id: { type: 'string', description: '用户 ID' },
      },
      required: ['bot', 'guild_id', 'user_id'],
    },
    platforms: ['qq'],
    tags: ['qq'],
    execute: async (args: Record<string, any>) => {
      const bot = qq.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      const member = await bot.getGuildMember(args.guild_id, args.user_id);
      return member;
    },
  }, plugin.name));

  return () => disposers.forEach(d => d());
});

// ── Web 控制台 ─────────────────────────────────────────────────────────
useContext("web", () => {
  PageManager.addEntry({
    id: "qq",
    development: path.resolve(import.meta.dirname, "../client/index.tsx"),
    production: path.resolve(import.meta.dirname, "../dist/index.js"),
    meta: { name: "QQ" },
  });
});

useContext("router", "qq", (router: any, qq: QQAdapter) => {
  router.get("/api/qq/bots", async (ctx: any) => {
    try {
      const bots = Array.from(qq.bots.values());
      const result = await Promise.all(bots.map(async (bot) => {
        try {
          let guildCount = 0;
          try { const guilds = await bot.getGuilds(); guildCount = guilds?.length || 0; } catch {}
          return {
            name: bot.$config.name,
            connected: bot.$connected || false,
            guildCount,
            status: bot.$connected ? "online" : "offline",
          };
        } catch {
          return { name: bot.$config.name, connected: false, guildCount: 0, status: "error" };
        }
      }));
      ctx.body = { success: true, data: result };
    } catch {
      ctx.status = 500;
      ctx.body = { success: false, error: "获取机器人数据失败" };
    }
  });

  // Bot 连接/断开
  router.post("/api/qq/bots/:name/connect", async (ctx: any) => {
    try {
      const bot = qq.bots.get(ctx.params.name);
      if (!bot) { ctx.status = 404; ctx.body = { success: false, error: "Bot 不存在" }; return; }
      if (bot.$connected) { ctx.body = { success: true, message: "已经在线" }; return; }
      await bot.$connect();
      ctx.body = { success: true, message: "连接成功" };
    } catch (e: any) {
      ctx.status = 500;
      ctx.body = { success: false, error: e?.message || "连接失败" };
    }
  });

  router.post("/api/qq/bots/:name/disconnect", async (ctx: any) => {
    try {
      const bot = qq.bots.get(ctx.params.name);
      if (!bot) { ctx.status = 404; ctx.body = { success: false, error: "Bot 不存在" }; return; }
      if (!bot.$connected) { ctx.body = { success: true, message: "已经离线" }; return; }
      await bot.$disconnect();
      ctx.body = { success: true, message: "已断开" };
    } catch (e: any) {
      ctx.status = 500;
      ctx.body = { success: false, error: e?.message || "断开失败" };
    }
  });

  // 频道列表
  router.get("/api/qq/bots/:name/guilds", async (ctx: any) => {
    try {
      const bot = qq.bots.get(ctx.params.name);
      if (!bot) { ctx.status = 404; ctx.body = { success: false, error: "Bot 不存在" }; return; }
      if (!bot.$connected) { ctx.status = 400; ctx.body = { success: false, error: "Bot 未连接" }; return; }
      const guilds = await bot.getGuilds();
      ctx.body = { success: true, data: guilds || [] };
    } catch (e: any) {
      ctx.status = 500;
      ctx.body = { success: false, error: e?.message || "获取频道失败" };
    }
  });

  // 子频道列表
  router.get("/api/qq/bots/:name/guilds/:guildId/channels", async (ctx: any) => {
    try {
      const bot = qq.bots.get(ctx.params.name);
      if (!bot) { ctx.status = 404; ctx.body = { success: false, error: "Bot 不存在" }; return; }
      if (!bot.$connected) { ctx.status = 400; ctx.body = { success: false, error: "Bot 未连接" }; return; }
      const channels = await bot.getChannels(ctx.params.guildId);
      ctx.body = { success: true, data: channels || [] };
    } catch (e: any) {
      ctx.status = 500;
      ctx.body = { success: false, error: e?.message || "获取子频道失败" };
    }
  });
});
