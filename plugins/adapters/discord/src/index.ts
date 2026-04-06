/**
 * Discord 适配器入口：单一适配器，支持 Gateway / Interactions（connection: gateway | interactions）
 */
import { usePlugin, type Plugin, type Context, type IGroupManagement } from "zhin.js";
import type { Router } from "@zhin.js/http";
import type { McpToolRegistry } from "@zhin.js/mcp";
import { registerGroupManagementMcpTools } from "@zhin.js/mcp/adapter-tools-helper";
import { DiscordAdapter, type DiscordBotLike } from "./adapter.js";

declare module "zhin.js" {
  namespace Plugin {
    interface Contexts {
      router: import("@zhin.js/http").Router;
    }
  }
  interface Adapters {
    discord: DiscordAdapter;
  }
}

export * from "./types.js";
export { DiscordBot } from "./bot.js";
export { DiscordInteractionsBot } from "./bot-interactions.js";
export { DiscordAdapter, type DiscordBotLike } from "./adapter.js";

const { provide, useContext } = usePlugin();
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
} as unknown as Context<"discord">);

useContext('mcp' as any, 'discord', (mcp: McpToolRegistry, discord: DiscordAdapter) => {
  const disposeGroup = registerGroupManagementMcpTools(
    mcp,
    discord as unknown as IGroupManagement & { bots: Map<string, any> },
    'discord',
  );

  function getGatewayBot(botId: string): DiscordBotLike {
    const bot = discord.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    if ((bot.$config as { connection?: string }).connection !== 'gateway') {
      throw new Error('此工具仅支持 connection: gateway');
    }
    return bot;
  }

  mcp.addTool({
    name: 'discord_add_role',
    description: '给成员添加 Discord 角色',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
        guild_id: { type: 'string', description: '服务器 ID' },
        user_id: { type: 'string', description: '用户 ID' },
        role_id: { type: 'string', description: '角色 ID' },
      },
      required: ['bot', 'guild_id', 'user_id', 'role_id'],
    },
    handler: async (args: Record<string, any>) => {
      const bot = getGatewayBot(args.bot) as any;
      const success = await bot.addRole(args.guild_id, args.user_id, args.role_id);
      return { success, message: success ? `已给用户 ${args.user_id} 添加角色` : '操作失败' };
    },
  });

  mcp.addTool({
    name: 'discord_remove_role',
    description: '移除成员的 Discord 角色',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
        guild_id: { type: 'string', description: '服务器 ID' },
        user_id: { type: 'string', description: '用户 ID' },
        role_id: { type: 'string', description: '角色 ID' },
      },
      required: ['bot', 'guild_id', 'user_id', 'role_id'],
    },
    handler: async (args: Record<string, any>) => {
      const bot = getGatewayBot(args.bot) as any;
      const success = await bot.removeRole(args.guild_id, args.user_id, args.role_id);
      return { success, message: success ? `已移除用户 ${args.user_id} 的角色` : '操作失败' };
    },
  });

  mcp.addTool({
    name: 'discord_list_roles',
    description: '获取 Discord 服务器角色列表',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
        guild_id: { type: 'string', description: '服务器 ID' },
      },
      required: ['bot', 'guild_id'],
    },
    handler: async (args: Record<string, any>) => {
      const bot = getGatewayBot(args.bot) as any;
      const roles = await bot.getRoles(args.guild_id);
      return { roles, count: roles.length };
    },
  });

  mcp.addTool({
    name: 'discord_create_thread',
    description: '在 Discord 频道中创建帖子/子线程',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
        channel_id: { type: 'string', description: '频道 ID' },
        name: { type: 'string', description: '帖子标题' },
        message_id: { type: 'string', description: '基于某条消息创建（可选）' },
        auto_archive_duration: {
          type: 'number',
          description: '自动归档时间（分钟：60/1440/4320/10080）',
        },
      },
      required: ['bot', 'channel_id', 'name'],
    },
    handler: async (args: Record<string, any>) => {
      const bot = getGatewayBot(args.bot) as any;
      const thread = await bot.createThread(args.channel_id, args.name, args.message_id, args.auto_archive_duration);
      return { success: true, thread_id: thread.id, message: `帖子 "${args.name}" 已创建` };
    },
  });

  mcp.addTool({
    name: 'discord_react',
    description: '对 Discord 消息添加表情反应',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
        channel_id: { type: 'string', description: '频道 ID' },
        message_id: { type: 'string', description: '消息 ID' },
        emoji: {
          type: 'string',
          description: '表情（Unicode 表情或自定义表情如 <:name:id>）',
        },
      },
      required: ['bot', 'channel_id', 'message_id', 'emoji'],
    },
    handler: async (args: Record<string, any>) => {
      const bot = getGatewayBot(args.bot) as any;
      await bot.addReaction(args.channel_id, args.message_id, args.emoji);
      return { success: true, message: `已添加反应 ${args.emoji}` };
    },
  });

  mcp.addTool({
    name: 'discord_send_embed',
    description: '发送 Discord 富文本嵌入消息（Embed）',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
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
      required: ['bot', 'channel_id'],
    },
    handler: async (args: Record<string, any>) => {
      const bot = getGatewayBot(args.bot) as any;
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
      const msg = await bot.sendEmbed(args.channel_id, embedData);
      return { success: true, message_id: msg.id, message: 'Embed 已发送' };
    },
  });

  mcp.addTool({
    name: 'discord_forum_post',
    description: '在 Discord 论坛频道中创建帖子',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
        channel_id: { type: 'string', description: '论坛频道 ID' },
        name: { type: 'string', description: '帖子标题' },
        content: { type: 'string', description: '帖子内容' },
        tags: { type: 'string', description: '标签名，逗号分隔（可选）' },
      },
      required: ['bot', 'channel_id', 'name', 'content'],
    },
    handler: async (args: Record<string, any>) => {
      const bot = getGatewayBot(args.bot) as any;
      const tagList = args.tags ? args.tags.split(',').map((t: string) => t.trim()) : undefined;
      const thread = await bot.createForumPost(args.channel_id, args.name, args.content, tagList);
      return { success: true, thread_id: thread.id, message: `论坛帖 "${args.name}" 已创建` };
    },
  });

  return () => {
    disposeGroup();
    mcp.removeTool('discord_add_role');
    mcp.removeTool('discord_remove_role');
    mcp.removeTool('discord_list_roles');
    mcp.removeTool('discord_create_thread');
    mcp.removeTool('discord_react');
    mcp.removeTool('discord_send_embed');
    mcp.removeTool('discord_forum_post');
  };
});
