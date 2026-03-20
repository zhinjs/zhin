/**
 * QQ 官方适配器
 */
import {
  Adapter,
  Plugin,
  createGroupManagementTools,
  type IGroupManagement,
} from "zhin.js";
import { QQBot } from "./bot.js";
import type { QQBotConfig, ReceiverMode } from "./types.js";

export class QQAdapter extends Adapter<QQBot<ReceiverMode>> {
  constructor(plugin: Plugin) {
    super(plugin, "qq", []);
  }

  createBot(config: QQBotConfig<ReceiverMode>): QQBot<ReceiverMode> {
    return new QQBot(this, config);
  }

  // ── IGroupManagement 标准群管方法 ──────────────────────────────────

  async kickMember(botId: string, sceneId: string, userId: string) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    return bot.removeGuildMember(sceneId, userId, false);
  }

  async muteMember(botId: string, sceneId: string, userId: string, duration = 600) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    return bot.muteMembers(sceneId, [userId], duration);
  }

  async muteAll(botId: string, sceneId: string, enable = true) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    return bot.muteAll(sceneId, enable ? 600 : 0);
  }

  async listMembers(botId: string, sceneId: string) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    return bot.getGuildMembers(sceneId);
  }

  async getGroupInfo(botId: string, sceneId: string) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    return bot.getGuildInfo(sceneId);
  }

  // ── 生命周期 ───────────────────────────────────────────────────────

  async start(): Promise<void> {
    this.registerQQPlatformTools();
    const groupTools = createGroupManagementTools(this as unknown as IGroupManagement, this.name);
    groupTools.forEach((t) => this.addTool(t));
    await super.start();
  }

  /**
   * 注册 QQ 官方平台特有工具（频道列表等）
   */
  private registerQQPlatformTools(): void {
    // 获取频道列表工具
    this.addTool({
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
      scopes: ['channel'],
      permissionLevel: 'user',
      execute: async (args) => {
        const { bot: botId } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const guilds = await bot.getGuilds();
        return { guilds, count: guilds.length };
      },
    });

    // 获取子频道列表工具
    this.addTool({
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
      scopes: ['channel'],
      permissionLevel: 'user',
      execute: async (args) => {
        const { bot: botId, guild_id } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const channels = await bot.getChannels(guild_id);
        return { channels, count: channels.length };
      },
    });

    // 获取角色列表工具
    this.addTool({
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
      scopes: ['channel'],
      permissionLevel: 'user',
      execute: async (args) => {
        const { bot: botId, guild_id } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const roles = await bot.getGuildRoles(guild_id);
        return { roles, count: roles.length };
      },
    });

    // 创建角色工具
    this.addTool({
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
      scopes: ['channel'],
      permissionLevel: 'group_admin',
      execute: async (args) => {
        const { bot: botId, guild_id, name, color } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const role = await bot.createGuildRole(guild_id, name, color);
        return { success: !!role, role, message: role ? `角色 "${name}" 创建成功` : '创建失败' };
      },
    });

    // 添加角色工具
    this.addTool({
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
      scopes: ['channel'],
      permissionLevel: 'group_admin',
      execute: async (args) => {
        const { bot: botId, guild_id, channel_id, user_id, role_id } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const success = await bot.addMemberRole(guild_id, channel_id, user_id, role_id);
        return { success, message: success ? `已给成员添加角色` : '操作失败' };
      },
    });

    // 移除角色工具
    this.addTool({
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
      scopes: ['channel'],
      permissionLevel: 'group_admin',
      execute: async (args) => {
        const { bot: botId, guild_id, channel_id, user_id, role_id } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const success = await bot.removeMemberRole(guild_id, channel_id, user_id, role_id);
        return { success, message: success ? `已移除成员的角色` : '操作失败' };
      },
    });

    // 子频道详情
    this.addTool({
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
      scopes: ['channel'],
      permissionLevel: 'user',
      execute: async (args) => {
        const { bot: botId, channel_id } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const info = await bot.getChannelInfo(channel_id);
        return info;
      },
    });

    // 单成员详情
    this.addTool({
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
      scopes: ['channel'],
      permissionLevel: 'user',
      execute: async (args) => {
        const { bot: botId, guild_id, user_id } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const member = await bot.getGuildMember(guild_id, user_id);
        return member;
      },
    });

    this.plugin.logger.debug('已注册 QQ 官方平台频道管理工具');
  }
}
