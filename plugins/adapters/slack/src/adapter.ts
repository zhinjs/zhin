/**
 * Slack 适配器
 */
import {
  Adapter,
  Plugin,
  createGroupManagementTools,
  type IGroupManagement,
} from "zhin.js";
import { SlackBot } from "./bot.js";
import type { SlackBotConfig } from "./types.js";

export class SlackAdapter extends Adapter<SlackBot> {
  constructor(plugin: Plugin) {
    super(plugin, "slack", []);
  }

  createBot(config: SlackBotConfig): SlackBot {
    return new SlackBot(this, config);
  }

  // ── IGroupManagement 标准群管方法 ──────────────────────────────────

  async kickMember(botId: string, sceneId: string, userId: string) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    return bot.kickFromChannel(sceneId, userId);
  }

  async setGroupName(botId: string, sceneId: string, name: string) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    return bot.renameChannel(sceneId, name);
  }

  async listMembers(botId: string, sceneId: string) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    return bot.getChannelMembers(sceneId);
  }

  async getGroupInfo(botId: string, sceneId: string) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    return bot.getChannelInfo(sceneId);
  }

  // ── 生命周期 ───────────────────────────────────────────────────────

  async start(): Promise<void> {
    this.registerSlackPlatformTools();
    const groupTools = createGroupManagementTools(this as unknown as IGroupManagement, this.name);
    groupTools.forEach((t) => this.addTool(t));
    await super.start();
  }

  /**
   * 注册 Slack 平台特有工具（邀请到频道等）
   */
  private registerSlackPlatformTools(): void {
    // 邀请用户到频道
    this.addTool({
      name: 'slack_invite_to_channel',
      description: '邀请用户加入 Slack 频道',
      parameters: {
        type: 'object',
        properties: {
          bot: { type: 'string', description: 'Bot 名称' },
          channel: { type: 'string', description: '频道 ID' },
          users: { type: 'array', items: { type: 'string' }, description: '用户 ID 列表' },
        },
        required: ['bot', 'channel', 'users'],
      },
      platforms: ['slack'],
      scopes: ['group'],
      permissionLevel: 'group_admin',
      execute: async (args) => {
        const { bot: botId, channel, users } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const success = await bot.inviteToChannel(channel, users);
        return { success, message: success ? `已邀请用户加入频道` : '操作失败' };
      },
    });

    // 设置频道话题
    this.addTool({
      name: 'slack_set_topic',
      description: '设置 Slack 频道话题',
      parameters: {
        type: 'object',
        properties: {
          bot: { type: 'string', description: 'Bot 名称' },
          channel: { type: 'string', description: '频道 ID' },
          topic: { type: 'string', description: '新话题' },
        },
        required: ['bot', 'channel', 'topic'],
      },
      platforms: ['slack'],
      scopes: ['group'],
      permissionLevel: 'group_admin',
      execute: async (args) => {
        const { bot: botId, channel, topic } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const success = await bot.setChannelTopic(channel, topic);
        return { success, message: success ? `已设置频道话题` : '操作失败' };
      },
    });

    // 归档频道
    this.addTool({
      name: 'slack_archive_channel',
      description: '归档 Slack 频道',
      parameters: {
        type: 'object',
        properties: {
          bot: { type: 'string', description: 'Bot 名称' },
          channel: { type: 'string', description: '频道 ID' },
        },
        required: ['bot', 'channel'],
      },
      platforms: ['slack'],
      scopes: ['group'],
      permissionLevel: 'group_admin',
      execute: async (args) => {
        const { bot: botId, channel } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const success = await bot.archiveChannel(channel);
        return { success, message: success ? `已归档频道` : '操作失败' };
      },
    });

    // 置顶消息
    this.addTool({
      name: 'slack_pin_message',
      description: '置顶 Slack 消息',
      parameters: {
        type: 'object',
        properties: {
          bot: { type: 'string', description: 'Bot 名称' },
          channel: { type: 'string', description: '频道 ID' },
          timestamp: { type: 'string', description: '消息时间戳' },
        },
        required: ['bot', 'channel', 'timestamp'],
      },
      platforms: ['slack'],
      scopes: ['group'],
      permissionLevel: 'group_admin',
      execute: async (args) => {
        const { bot: botId, channel, timestamp } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const success = await bot.pinMessage(channel, timestamp);
        return { success, message: success ? `已置顶消息` : '操作失败' };
      },
    });

    // 添加反应
    this.addTool({
      name: 'slack_add_reaction',
      description: '给 Slack 消息添加表情反应',
      parameters: {
        type: 'object',
        properties: {
          bot: { type: 'string', description: 'Bot 名称' },
          channel: { type: 'string', description: '频道 ID' },
          timestamp: { type: 'string', description: '消息时间戳' },
          emoji: { type: 'string', description: '表情名称（不含冒号）' },
        },
        required: ['bot', 'channel', 'timestamp', 'emoji'],
      },
      platforms: ['slack'],
      scopes: ['group', 'private'],
      permissionLevel: 'user',
      execute: async (args) => {
        const { bot: botId, channel, timestamp, emoji } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const success = await bot.addReaction(channel, timestamp, emoji);
        return { success, message: success ? `已添加反应 :${emoji}:` : '操作失败' };
      },
    });

    // 移除表情反应
    this.addTool({
      name: 'slack_remove_reaction',
      description: '移除 Slack 消息上的表情反应',
      parameters: {
        type: 'object',
        properties: {
          bot: { type: 'string', description: 'Bot 名称' },
          channel_id: { type: 'string', description: '频道 ID' },
          timestamp: { type: 'string', description: '消息时间戳' },
          name: { type: 'string', description: '表情名称（如 thumbsup、heart）' },
        },
        required: ['bot', 'channel_id', 'timestamp', 'name'],
      },
      platforms: ['slack'],
      scopes: ['group'],
      permissionLevel: 'user',
      execute: async (args) => {
        const { bot: botId, channel_id, timestamp, name } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const success = await bot.removeReaction(channel_id, timestamp, name);
        return { success, message: success ? `已移除反应 :${name}:` : '操作失败' };
      },
    });

    // 取消置顶消息
    this.addTool({
      name: 'slack_unpin_message',
      description: '取消 Slack 频道中消息的置顶',
      parameters: {
        type: 'object',
        properties: {
          bot: { type: 'string', description: 'Bot 名称' },
          channel_id: { type: 'string', description: '频道 ID' },
          timestamp: { type: 'string', description: '消息时间戳' },
        },
        required: ['bot', 'channel_id', 'timestamp'],
      },
      platforms: ['slack'],
      scopes: ['group'],
      permissionLevel: 'group_admin',
      execute: async (args) => {
        const { bot: botId, channel_id, timestamp } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const success = await bot.unpinMessage(channel_id, timestamp);
        return { success, message: success ? '已取消置顶' : '操作失败' };
      },
    });

    // 查询用户信息
    this.addTool({
      name: 'slack_user_info',
      description: '查询 Slack 用户详细信息',
      parameters: {
        type: 'object',
        properties: {
          bot: { type: 'string', description: 'Bot 名称' },
          user_id: { type: 'string', description: '用户 ID' },
        },
        required: ['bot', 'user_id'],
      },
      platforms: ['slack'],
      scopes: ['group', 'private'],
      permissionLevel: 'user',
      execute: async (args) => {
        const { bot: botId, user_id } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const user = await bot.getUserInfo(user_id);
        return {
          id: user.id,
          name: user.name,
          real_name: user.real_name,
          display_name: user.profile?.display_name,
          email: user.profile?.email,
          is_admin: user.is_admin,
          is_bot: user.is_bot,
          status_text: user.profile?.status_text,
        };
      },
    });

    // 设置频道用途
    this.addTool({
      name: 'slack_set_purpose',
      description: '设置 Slack 频道的用途/目的',
      parameters: {
        type: 'object',
        properties: {
          bot: { type: 'string', description: 'Bot 名称' },
          channel_id: { type: 'string', description: '频道 ID' },
          purpose: { type: 'string', description: '频道用途描述' },
        },
        required: ['bot', 'channel_id', 'purpose'],
      },
      platforms: ['slack'],
      scopes: ['group'],
      permissionLevel: 'group_admin',
      execute: async (args) => {
        const { bot: botId, channel_id, purpose } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const success = await bot.setChannelPurpose(channel_id, purpose);
        return { success, message: success ? '频道用途已更新' : '操作失败' };
      },
    });

    // 恢复归档频道
    this.addTool({
      name: 'slack_unarchive',
      description: '恢复已归档的 Slack 频道',
      parameters: {
        type: 'object',
        properties: {
          bot: { type: 'string', description: 'Bot 名称' },
          channel_id: { type: 'string', description: '频道 ID' },
        },
        required: ['bot', 'channel_id'],
      },
      platforms: ['slack'],
      scopes: ['group'],
      permissionLevel: 'group_admin',
      execute: async (args) => {
        const { bot: botId, channel_id } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const success = await bot.unarchiveChannel(channel_id);
        return { success, message: success ? '频道已恢复' : '操作失败' };
      },
    });

    this.plugin.logger.debug('已注册 Slack 平台工作区管理工具');
  }
}
