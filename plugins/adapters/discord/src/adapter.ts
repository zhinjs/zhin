/**
 * Discord 适配器：单一适配器支持 Gateway / Interactions，由 config.connection 区分
 */
import type { Router } from "@zhin.js/http";
import {
  Adapter,
  Plugin,
  createGroupManagementTools,
  type IGroupManagement,
} from "zhin.js";
import { DiscordBot } from "./bot.js";
import { DiscordInteractionsBot } from "./bot-interactions.js";
import type {
  DiscordBotConfig,
  DiscordGatewayConfig,
  DiscordInteractionsConfig,
} from "./types.js";

export type DiscordBotLike = DiscordBot | DiscordInteractionsBot;

function isGatewayBot(bot: DiscordBotLike): bot is DiscordBot {
  return (bot.$config as { connection?: string }).connection === "gateway";
}

export class DiscordAdapter extends Adapter<DiscordBotLike> {
  #router?: Router;

  constructor(plugin: Plugin) {
    super(plugin, "discord", []);
  }

  createBot(config: DiscordBotConfig): DiscordBotLike {
    const connection = config.connection ?? "gateway";
    switch (connection) {
      case "gateway":
        return new DiscordBot(this, config as DiscordGatewayConfig);
      case "interactions":
        if (!this.#router) {
          throw new Error(
            "Discord connection: interactions 需要 router，请安装并在配置中启用 @zhin.js/http"
          );
        }
        return new DiscordInteractionsBot(this, this.#router, config as DiscordInteractionsConfig);
      default:
        throw new Error(`Unknown Discord connection: ${(config as DiscordBotConfig).connection}`);
    }
  }

  async kickMember(botId: string, sceneId: string, userId: string) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    if (!isGatewayBot(bot)) throw new Error("群管仅支持 connection: gateway");
    return bot.kickMember(sceneId, userId);
  }

  async banMember(botId: string, sceneId: string, userId: string, reason?: string) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    if (!isGatewayBot(bot)) throw new Error("群管仅支持 connection: gateway");
    return bot.banMember(sceneId, userId, reason);
  }

  async unbanMember(botId: string, sceneId: string, userId: string) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    if (!isGatewayBot(bot)) throw new Error("群管仅支持 connection: gateway");
    return bot.unbanMember(sceneId, userId);
  }

  async muteMember(botId: string, sceneId: string, userId: string, duration = 600) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    if (!isGatewayBot(bot)) throw new Error("群管仅支持 connection: gateway");
    return bot.timeoutMember(sceneId, userId, duration);
  }

  async setMemberNickname(botId: string, sceneId: string, userId: string, nickname: string) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    if (!isGatewayBot(bot)) throw new Error("群管仅支持 connection: gateway");
    return bot.setNickname(sceneId, userId, nickname);
  }

  async listMembers(botId: string, sceneId: string) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    if (!isGatewayBot(bot)) throw new Error("群管仅支持 connection: gateway");
    return bot.getMembers(sceneId);
  }

  async getGroupInfo(botId: string, sceneId: string) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    if (!isGatewayBot(bot)) throw new Error("群管仅支持 connection: gateway");
    return bot.getGuildInfo(sceneId);
  }

  async start(): Promise<void> {
    this.#router = (this.plugin.inject as (key: string) => Router | undefined)("router");
    (this.plugin.useContext as (key: string, fn: (router: Router) => void) => void)(
      "router",
      (router: Router) => {
        this.#router = router;
      }
    );
    this.registerDiscordPlatformTools();
    const groupTools = createGroupManagementTools(this as unknown as IGroupManagement, this.name);
    groupTools.forEach((t) => this.addTool(t));
    await super.start();
  }

  private registerDiscordPlatformTools(): void {
    this.addTool({
      name: "discord_add_role",
      description: "给成员添加 Discord 角色",
      parameters: {
        type: "object",
        properties: {
          bot: { type: "string", description: "Bot 名称" },
          guild_id: { type: "string", description: "服务器 ID" },
          user_id: { type: "string", description: "用户 ID" },
          role_id: { type: "string", description: "角色 ID" },
        },
        required: ["bot", "guild_id", "user_id", "role_id"],
      },
      platforms: ["discord"],
      scopes: ["channel"],
      permissionLevel: "group_admin",
      execute: async (args) => {
        const { bot: botId, guild_id, user_id, role_id } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        if (!isGatewayBot(bot)) throw new Error("此工具仅支持 connection: gateway");
        const success = await bot.addRole(guild_id, user_id, role_id);
        return { success, message: success ? `已给用户 ${user_id} 添加角色` : "操作失败" };
      },
    });

    this.addTool({
      name: "discord_remove_role",
      description: "移除成员的 Discord 角色",
      parameters: {
        type: "object",
        properties: {
          bot: { type: "string", description: "Bot 名称" },
          guild_id: { type: "string", description: "服务器 ID" },
          user_id: { type: "string", description: "用户 ID" },
          role_id: { type: "string", description: "角色 ID" },
        },
        required: ["bot", "guild_id", "user_id", "role_id"],
      },
      platforms: ["discord"],
      scopes: ["channel"],
      permissionLevel: "group_admin",
      execute: async (args) => {
        const { bot: botId, guild_id, user_id, role_id } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        if (!isGatewayBot(bot)) throw new Error("此工具仅支持 connection: gateway");
        const success = await bot.removeRole(guild_id, user_id, role_id);
        return { success, message: success ? `已移除用户 ${user_id} 的角色` : "操作失败" };
      },
    });

    this.addTool({
      name: "discord_list_roles",
      description: "获取 Discord 服务器角色列表",
      parameters: {
        type: "object",
        properties: {
          bot: { type: "string", description: "Bot 名称" },
          guild_id: { type: "string", description: "服务器 ID" },
        },
        required: ["bot", "guild_id"],
      },
      platforms: ["discord"],
      scopes: ["channel"],
      permissionLevel: "user",
      execute: async (args) => {
        const { bot: botId, guild_id } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        if (!isGatewayBot(bot)) throw new Error("此工具仅支持 connection: gateway");
        const roles = await bot.getRoles(guild_id);
        return { roles, count: roles.length };
      },
    });

    this.addTool({
      name: "discord_create_thread",
      description: "在 Discord 频道中创建帖子/子线程",
      parameters: {
        type: "object",
        properties: {
          bot: { type: "string", description: "Bot 名称" },
          channel_id: { type: "string", description: "频道 ID" },
          name: { type: "string", description: "帖子标题" },
          message_id: { type: "string", description: "基于某条消息创建（可选）" },
          auto_archive_duration: {
            type: "number",
            description: "自动归档时间（分钟：60/1440/4320/10080）",
          },
        },
        required: ["bot", "channel_id", "name"],
      },
      platforms: ["discord"],
      scopes: ["channel"],
      permissionLevel: "user",
      execute: async (args) => {
        const { bot: botId, channel_id, name, message_id, auto_archive_duration } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        if (!isGatewayBot(bot)) throw new Error("此工具仅支持 connection: gateway");
        const thread = await bot.createThread(channel_id, name, message_id, auto_archive_duration);
        return { success: true, thread_id: thread.id, message: `帖子 "${name}" 已创建` };
      },
    });

    this.addTool({
      name: "discord_react",
      description: "对 Discord 消息添加表情反应",
      parameters: {
        type: "object",
        properties: {
          bot: { type: "string", description: "Bot 名称" },
          channel_id: { type: "string", description: "频道 ID" },
          message_id: { type: "string", description: "消息 ID" },
          emoji: {
            type: "string",
            description: "表情（Unicode 表情或自定义表情如 <:name:id>）",
          },
        },
        required: ["bot", "channel_id", "message_id", "emoji"],
      },
      platforms: ["discord"],
      scopes: ["channel", "private"],
      permissionLevel: "user",
      execute: async (args) => {
        const { bot: botId, channel_id, message_id, emoji } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        if (!isGatewayBot(bot)) throw new Error("此工具仅支持 connection: gateway");
        await bot.addReaction(channel_id, message_id, emoji);
        return { success: true, message: `已添加反应 ${emoji}` };
      },
    });

    this.addTool({
      name: "discord_send_embed",
      description: "发送 Discord 富文本嵌入消息（Embed）",
      parameters: {
        type: "object",
        properties: {
          bot: { type: "string", description: "Bot 名称" },
          channel_id: { type: "string", description: "频道 ID" },
          title: { type: "string", description: "Embed 标题" },
          description: { type: "string", description: "Embed 描述" },
          color: { type: "number", description: "颜色值（十进制，如 0x00ff00 = 65280）" },
          url: { type: "string", description: "标题链接（可选）" },
          fields: {
            type: "string",
            description: '字段，JSON 格式: [{"name":"k","value":"v","inline":false}]',
          },
        },
        required: ["bot", "channel_id"],
      },
      platforms: ["discord"],
      scopes: ["channel", "private"],
      permissionLevel: "user",
      execute: async (args) => {
        const { bot: botId, channel_id, title, description, color, url, fields } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        if (!isGatewayBot(bot)) throw new Error("此工具仅支持 connection: gateway");
        const embedData: any = {};
        if (title) embedData.title = title;
        if (description) embedData.description = description;
        if (color) embedData.color = color;
        if (url) embedData.url = url;
        if (fields) {
          try {
            embedData.fields = JSON.parse(fields);
          } catch {
            return { success: false, message: "fields 格式错误，应为 JSON 数组" };
          }
        }
        const msg = await bot.sendEmbed(channel_id, embedData);
        return { success: true, message_id: msg.id, message: "Embed 已发送" };
      },
    });

    this.addTool({
      name: "discord_forum_post",
      description: "在 Discord 论坛频道中创建帖子",
      parameters: {
        type: "object",
        properties: {
          bot: { type: "string", description: "Bot 名称" },
          channel_id: { type: "string", description: "论坛频道 ID" },
          name: { type: "string", description: "帖子标题" },
          content: { type: "string", description: "帖子内容" },
          tags: { type: "string", description: "标签名，逗号分隔（可选）" },
        },
        required: ["bot", "channel_id", "name", "content"],
      },
      platforms: ["discord"],
      scopes: ["channel"],
      permissionLevel: "user",
      execute: async (args) => {
        const { bot: botId, channel_id, name, content, tags } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        if (!isGatewayBot(bot)) throw new Error("此工具仅支持 connection: gateway");
        const tagList = tags ? tags.split(",").map((t: string) => t.trim()) : undefined;
        const thread = await bot.createForumPost(channel_id, name, content, tagList);
        return { success: true, thread_id: thread.id, message: `论坛帖 "${name}" 已创建` };
      },
    });

    this.plugin.logger.debug("已注册 Discord 平台服务器管理工具");
  }
}
