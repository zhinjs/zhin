/**
 * Discord 适配器入口：单一适配器，支持 Gateway / Interactions（connection: gateway | interactions）
 */
import path from "node:path";
import { usePlugin, type Plugin, type Context, type IGroupManagement, createGroupManagementTools, type ToolFeature } from "zhin.js";
import type { Router } from "@zhin.js/host-router";
import { PageManager } from "@zhin.js/host-api";
import { DiscordAdapter, type DiscordEndpointLike } from "./adapter.js";
import {
  discordGroupPermitResolver,
  platformPermit,
  registerDiscordPlatformPermitChecker,
} from "./platform-permit.js";

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
  const groupTools = createGroupManagementTools(
    discord as unknown as IGroupManagement,
    'discord',
    { permitResolver: discordGroupPermitResolver, registerChecker: false },
  );
  disposers.push(...groupTools.map(t => toolService.addTool(t, plugin.name)));

  function getGatewayBot(endpointId: string): DiscordEndpointLike {
    const endpoint = discord.endpoints.get(endpointId);
    if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
    if ((endpoint.$config as { connection?: string }).connection !== 'gateway') {
      throw new Error('此工具仅支持 connection: gateway');
    }
    return endpoint;
  }

  disposers.push(toolService.addTool({
    name: 'discord_add_role',
    description: '给成员添加 Discord 角色',
    parameters: {
      type: 'object',
      properties: {
        endpoint_id: { type: 'string', description: 'Endpoint 名称', contextKey: 'endpointId' },
        guild_id: { type: 'string', description: '服务器 ID' },
        user_id: { type: 'string', description: '用户 ID' },
        role_id: { type: 'string', description: '角色 ID' },
      },
      required: ['endpoint_id', 'guild_id', 'user_id', 'role_id'],
    },
    platforms: ['discord'],
    tags: ['discord'],
    permissions: [platformPermit('manage_roles')],
    execute: async (args: Record<string, any>) => {
      const endpoint = getGatewayBot(args.endpoint_id) as any;
      const success = await endpoint.addRole(args.guild_id, args.user_id, args.role_id);
      return { success, message: success ? `已给用户 ${args.user_id} 添加角色` : '操作失败' };
    },
  }, plugin.name));

  disposers.push(toolService.addTool({
    name: 'discord_remove_role',
    description: '移除成员的 Discord 角色',
    parameters: {
      type: 'object',
      properties: {
        endpoint_id: { type: 'string', description: 'Endpoint 名称', contextKey: 'endpointId' },
        guild_id: { type: 'string', description: '服务器 ID' },
        user_id: { type: 'string', description: '用户 ID' },
        role_id: { type: 'string', description: '角色 ID' },
      },
      required: ['endpoint_id', 'guild_id', 'user_id', 'role_id'],
    },
    platforms: ['discord'],
    tags: ['discord'],
    permissions: [platformPermit('manage_roles')],
    execute: async (args: Record<string, any>) => {
      const endpoint = getGatewayBot(args.endpoint_id) as any;
      const success = await endpoint.removeRole(args.guild_id, args.user_id, args.role_id);
      return { success, message: success ? `已移除用户 ${args.user_id} 的角色` : '操作失败' };
    },
  }, plugin.name));

  disposers.push(toolService.addTool({
    name: 'discord_list_roles',
    description: '获取 Discord 服务器角色列表',
    parameters: {
      type: 'object',
      properties: {
        endpoint_id: { type: 'string', description: 'Endpoint 名称', contextKey: 'endpointId' },
        guild_id: { type: 'string', description: '服务器 ID' },
      },
      required: ['endpoint_id', 'guild_id'],
    },
    platforms: ['discord'],
    tags: ['discord'],
    permissions: [platformPermit('manage_roles')],
    execute: async (args: Record<string, any>) => {
      const endpoint = getGatewayBot(args.endpoint_id) as any;
      const roles = await endpoint.getRoles(args.guild_id);
      return { roles, count: roles.length };
    },
  }, plugin.name));

  disposers.push(toolService.addTool({
    name: 'discord_create_thread',
    description: '在 Discord 频道中创建帖子/子线程',
    parameters: {
      type: 'object',
      properties: {
        endpoint_id: { type: 'string', description: 'Endpoint 名称', contextKey: 'endpointId' },
        channel_id: { type: 'string', description: '频道 ID' },
        name: { type: 'string', description: '帖子标题' },
        message_id: { type: 'string', description: '基于某条消息创建（可选）' },
        auto_archive_duration: {
          type: 'number',
          description: '自动归档时间（分钟：60/1440/4320/10080）',
        },
      },
      required: ['endpoint_id', 'channel_id', 'name'],
    },
    platforms: ['discord'],
    tags: ['discord'],
    permissions: [platformPermit('manage_channels')],
    execute: async (args: Record<string, any>) => {
      const endpoint = getGatewayBot(args.endpoint_id) as any;
      const thread = await endpoint.createThread(args.channel_id, args.name, args.message_id, args.auto_archive_duration);
      return { success: true, thread_id: thread.id, message: `帖子 "${args.name}" 已创建` };
    },
  }, plugin.name));

  disposers.push(toolService.addTool({
    name: 'discord_react',
    description: '对 Discord 消息添加表情反应',
    parameters: {
      type: 'object',
      properties: {
        endpoint_id: { type: 'string', description: 'Endpoint 名称', contextKey: 'endpointId' },
        channel_id: { type: 'string', description: '频道 ID' },
        message_id: { type: 'string', description: '消息 ID' },
        emoji: {
          type: 'string',
          description: '表情（Unicode 表情或自定义表情如 <:name:id>）',
        },
      },
      required: ['endpoint_id', 'channel_id', 'message_id', 'emoji'],
    },
    platforms: ['discord'],
    tags: ['discord'],
    execute: async (args: Record<string, any>) => {
      const endpoint = getGatewayBot(args.endpoint_id) as any;
      await endpoint.addReaction(args.channel_id, args.message_id, args.emoji);
      return { success: true, message: `已添加反应 ${args.emoji}` };
    },
  }, plugin.name));

  disposers.push(toolService.addTool({
    name: 'discord_send_embed',
    description: '发送 Discord 富文本嵌入消息（Embed）',
    parameters: {
      type: 'object',
      properties: {
        endpoint_id: { type: 'string', description: 'Endpoint 名称', contextKey: 'endpointId' },
        channel_id: { type: 'string', description: '频道 ID' },
        title: { type: 'string', description: 'Embed 标题' },
        description: { type: 'string', description: 'Embed 描述' },
        color: { type: 'number', description: '颜色值（十进制，如 0x00ff00 = 65280）' },
        url: { type: 'string', description: '标题链接（可选）' },
        fields: {
          type: 'string',
          description: '字段，JSON 格式: [{"name":"k","value":"v","inline":false}]',
        },
      },
      required: ['endpoint_id', 'channel_id'],
    },
    platforms: ['discord'],
    tags: ['discord'],
    execute: async (args: Record<string, any>) => {
      const endpoint = getGatewayBot(args.endpoint_id) as any;
      const embedData: any = {};
      if (args.title) embedData.title = args.title;
      if (args.description) embedData.description = args.description;
      if (args.color) embedData.color = args.color;
      if (args.url) embedData.url = args.url;
      if (args.fields) {
        try {
          embedData.fields = JSON.parse(args.fields);
        } catch {
          return { success: false, message: 'fields 格式错误，应为 JSON 数组' };
        }
      }
      const msg = await endpoint.sendEmbed(args.channel_id, embedData);
      return { success: true, message_id: msg.id, message: 'Embed 已发送' };
    },
  }, plugin.name));

  disposers.push(toolService.addTool({
    name: 'discord_forum_post',
    description: '在 Discord 论坛频道中创建帖子',
    parameters: {
      type: 'object',
      properties: {
        endpoint_id: { type: 'string', description: 'Endpoint 名称', contextKey: 'endpointId' },
        channel_id: { type: 'string', description: '论坛频道 ID' },
        name: { type: 'string', description: '帖子标题' },
        content: { type: 'string', description: '帖子内容' },
        tags: { type: 'string', description: '标签名，逗号分隔（可选）' },
      },
      required: ['endpoint_id', 'channel_id', 'name', 'content'],
    },
    platforms: ['discord'],
    tags: ['discord'],
    execute: async (args: Record<string, any>) => {
      const endpoint = getGatewayBot(args.endpoint_id) as any;
      const tagList = args.tags ? args.tags.split(',').map((t: string) => t.trim()) : undefined;
      const thread = await endpoint.createForumPost(args.channel_id, args.name, args.content, tagList);
      return { success: true, thread_id: thread.id, message: `论坛帖 "${args.name}" 已创建` };
    },
  }, plugin.name));

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
