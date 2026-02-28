import {
  Bot,
  PrivateMessageEvent,
  GroupMessageEvent,
  ReceiverMode,
  ApplicationPlatform,
} from "qq-official-bot";
import path from "path";
export { ReceiverMode } from "qq-official-bot";
export type { ApplicationPlatform, Intent } from "qq-official-bot";
import {
  Bot as ZhinBot,
  usePlugin,
  Adapter,
  Plugin,
  Message,
  SendOptions,
  SendContent,
  segment,
  Tool,
  ToolPermissionLevel,
} from "zhin.js";

// 类型扩展 - 使用 zhin.js 模式
declare module "zhin.js" {
  interface Adapters {
    qq: QQAdapter;
  }
}

const plugin = usePlugin();
const { provide, useContext } = plugin;

// 定义配置接口 (直接定义完整接口)
export type QQBotConfig<T extends ReceiverMode, M extends ApplicationPlatform = ApplicationPlatform> =
  Bot.Config<T, M> & {
    context: "qq";
    name: string;
    data_dir?: string;
  };

export interface QQBot<T extends ReceiverMode, M extends ApplicationPlatform = ApplicationPlatform> {
  $config: QQBotConfig<T, M>;
}

export class QQBot<T extends ReceiverMode, M extends ApplicationPlatform = ApplicationPlatform>
  extends Bot
  implements ZhinBot<QQBotConfig<T, M>, PrivateMessageEvent | GroupMessageEvent>
{
  $connected: boolean = false;

  get $id() {
    return this.$config.name;
  }

  constructor(public adapter: QQAdapter, config: QQBotConfig<T, M>) {
    if (!config.data_dir) config.data_dir = path.join(process.cwd(), "data");
    super(config);
    this.$config = config;
  }

  private handleQQMessage(msg: PrivateMessageEvent | GroupMessageEvent): void {
    const message = this.$formatMessage(msg);
    this.adapter.emit("message.receive", message);
    plugin.logger.debug(`${this.$config.name} recv  ${message.$channel.type}(${message.$channel.id}):${segment.raw(message.$content)}`);
  }

  async $connect(): Promise<void> {
    this.on("message.group", this.handleQQMessage.bind(this));
    this.on("message.guild", this.handleQQMessage.bind(this));
    this.on("message.private", this.handleQQMessage.bind(this));
    await this.start();
    this.$connected = true;
  }

  async $disconnect(): Promise<void> {
    await this.stop();
    this.$connected = false;
  }

  $formatMessage(msg: PrivateMessageEvent | GroupMessageEvent) {
    let target_id = msg.user_id;
    if (msg.message_type === "guild") target_id = msg.channel_id!;
    if (msg.message_type === "group") target_id = msg.group_id!;
    if (msg.sub_type === "direct") target_id = `direct:${msg.guild_id}`;
    const result = Message.from(msg, {
      $id: msg.message_id?.toString(),
      $adapter: "qq" as const,
      $bot: this.$config.name,
      $sender: {
        id: msg.sender.user_id?.toString(),
        name: msg.sender.user_name?.toString(),
      },
      $channel: {
        id: target_id,
        type: msg.message_type === "guild" ? "channel" : msg.message_type,
      },
      $content: msg.message,
      $raw: msg.raw_message,
      $timestamp: Date.now(),
      $recall: async () => {
        await this.$recallMessage(result.$id);
      },
      $reply: async (content: SendContent, quote: boolean | string = true): Promise<string> => {
        if (!Array.isArray(content)) content = [content];
        if (quote) content.unshift({ type: "reply", data: { id: typeof quote === "boolean" ? result.$id : quote } });
        return await this.adapter.sendMessage({
          ...result.$channel,
          context: "qq",
          bot: this.$config.name,
          content,
        });
      },
    });
    return result;
  }

  async $sendMessage(options: SendOptions): Promise<string> {
    switch (options.type) {
      case "private": {
        if (options.id.startsWith("direct:")) {
          const id = options.id.replace("direct:", "");
          const result = await this.sendDirectMessage(id, options.content);
          plugin.logger.debug(`${this.$config.name} send ${options.type}(${options.id}):${segment.raw(options.content)}`);
          return `direct-${options.id}:${result.id.toString()}`;
        } else {
          const result = await this.sendPrivateMessage(options.id, options.content);
          plugin.logger.debug(`${this.$config.name} send ${options.type}(${options.id}):${segment.raw(options.content)}`);
          return `private-${options.id}:${result.id.toString()}`;
        }
      }
      case "group": {
        const result = await this.sendGroupMessage(options.id, options.content);
        plugin.logger.debug(`${this.$config.name} send ${options.type}(${options.id}):${segment.raw(options.content)}`);
        return `group-${options.id}:${result.id.toString()}`;
      }
      case "channel": {
        const result = await this.sendGuildMessage(options.id, options.content);
        plugin.logger.debug(`${this.$config.name} send ${options.type}(${options.id}):${segment.raw(options.content)}`);
        return `channel-${options.id}:${result.id.toString()}`;
      }
      default:
        throw new Error(`unsupported channel type ${options.type}`);
    }
  }

  async $recallMessage(id: string): Promise<void> {
    if (!/^(private|group|channel|direct)-([^\:]+):(.+)$/.test(id)) throw new Error(`invalid message id ${id}`);
    const match = id.match(/^(private|group|channel|direct)-([^\:]+):(.+)$/);
    if (!match) return;
    const [, target_type, target_id, message_id] = match;
    if (target_type === "private") await this.recallPrivateMessage(target_id, message_id);
    if (target_type === "group") await this.recallGroupMessage(target_id, message_id);
    if (target_type === "channel") await this.recallGuildMessage(target_id, message_id);
    if (target_type === "direct") await this.recallDirectMessage(target_id, message_id);
  }

  // ==================== 频道管理 API ====================

  /**
   * 获取频道列表
   */
  async getGuilds(): Promise<any[]> {
    try {
      return await this.guildService.getList();
    } catch (error) {
      plugin.logger.error(`QQ Bot ${this.$id} 获取频道列表失败:`, error);
      throw error;
    }
  }

  /**
   * 获取频道详情
   * @param guildId 频道 ID
   */
  async getGuildInfo(guildId: string): Promise<any> {
    try {
      return await this.guildService.getInfo(guildId);
    } catch (error) {
      plugin.logger.error(`QQ Bot ${this.$id} 获取频道详情失败:`, error);
      throw error;
    }
  }

  /**
   * 获取子频道列表
   * @param guildId 频道 ID
   */
  async getChannels(guildId: string): Promise<any[]> {
    try {
      return await this.channelService.getList(guildId);
    } catch (error) {
      plugin.logger.error(`QQ Bot ${this.$id} 获取子频道列表失败:`, error);
      throw error;
    }
  }

  /**
   * 获取子频道详情
   * @param channelId 子频道 ID
   */
  async getChannelInfo(channelId: string): Promise<any> {
    try {
      return await this.channelService.getInfo(channelId);
    } catch (error) {
      plugin.logger.error(`QQ Bot ${this.$id} 获取子频道详情失败:`, error);
      throw error;
    }
  }

  /**
   * 获取频道成员列表
   * @param guildId 频道 ID
   */
  async getGuildMembers(guildId: string): Promise<any[]> {
    try {
      return await this.memberService.getGuildMemberList(guildId);
    } catch (error) {
      plugin.logger.error(`QQ Bot ${this.$id} 获取频道成员列表失败:`, error);
      throw error;
    }
  }

  /**
   * 获取频道成员详情
   * @param guildId 频道 ID
   * @param userId 用户 ID
   */
  async getGuildMember(guildId: string, userId: string): Promise<any> {
    try {
      return await this.memberService.getGuildMemberInfo(guildId, userId);
    } catch (error) {
      plugin.logger.error(`QQ Bot ${this.$id} 获取成员详情失败:`, error);
      throw error;
    }
  }

  /**
   * 删除频道成员（踢出）
   * @param guildId 频道 ID
   * @param userId 用户 ID
   * @param addBlacklist 是否加入黑名单
   * @param deleteHistoryMsg 删除历史消息天数 (-1不删除，0全部删除，3/7/15/30)
   */
  async removeGuildMember(guildId: string, userId: string, addBlacklist?: boolean, deleteHistoryMsg?: -1 | 0 | 3 | 7 | 15 | 30): Promise<boolean> {
    try {
      await this.memberService.kickMember(guildId, userId, deleteHistoryMsg, addBlacklist);
      plugin.logger.info(`QQ Bot ${this.$id} 踢出成员 ${userId}（频道 ${guildId}）`);
      return true;
    } catch (error) {
      plugin.logger.error(`QQ Bot ${this.$id} 踢出成员失败:`, error);
      throw error;
    }
  }

  /**
   * 获取频道角色列表
   * @param guildId 频道 ID
   */
  async getGuildRoles(guildId: string): Promise<any[]> {
    try {
      return await this.guildService.getRoles(guildId);
    } catch (error) {
      plugin.logger.error(`QQ Bot ${this.$id} 获取角色列表失败:`, error);
      throw error;
    }
  }

  /**
   * 创建频道角色
   * @param guildId 频道 ID
   * @param name 角色名
   * @param color 颜色
   * @param hoist 是否在成员列表中单独展示 (0 或 1)
   */
  async createGuildRole(guildId: string, name: string, color?: number, hoist?: 0 | 1): Promise<any> {
    try {
      const result = await this.guildService.createRole(guildId, { name, color: color || 0, hoist: hoist ?? 0 });
      plugin.logger.info(`QQ Bot ${this.$id} 创建角色 "${name}"（频道 ${guildId}）`);
      return result;
    } catch (error) {
      plugin.logger.error(`QQ Bot ${this.$id} 创建角色失败:`, error);
      throw error;
    }
  }

  /**
   * 给成员添加角色
   * @param guildId 频道 ID
   * @param channelId 子频道 ID
   * @param userId 用户 ID
   * @param roleId 角色 ID
   */
  async addMemberRole(guildId: string, channelId: string, userId: string, roleId: string): Promise<boolean> {
    try {
      await this.memberService.addMemberRole(guildId, channelId, userId, roleId);
      plugin.logger.info(`QQ Bot ${this.$id} 给成员 ${userId} 添加角色 ${roleId}（频道 ${guildId}）`);
      return true;
    } catch (error) {
      plugin.logger.error(`QQ Bot ${this.$id} 添加角色失败:`, error);
      throw error;
    }
  }

  /**
   * 移除成员角色
   * @param guildId 频道 ID
   * @param channelId 子频道 ID
   * @param userId 用户 ID
   * @param roleId 角色 ID
   */
  async removeMemberRole(guildId: string, channelId: string, userId: string, roleId: string): Promise<boolean> {
    try {
      await this.memberService.removeMemberRole(guildId, channelId, userId, roleId);
      plugin.logger.info(`QQ Bot ${this.$id} 移除成员 ${userId} 的角色 ${roleId}（频道 ${guildId}）`);
      return true;
    } catch (error) {
      plugin.logger.error(`QQ Bot ${this.$id} 移除角色失败:`, error);
      throw error;
    }
  }

  /**
   * 禁言成员（批量）
   * @param guildId 频道 ID
   * @param userIds 用户 ID 列表
   * @param muteSeconds 禁言时长（秒），0 表示解除禁言
   */
  async muteMembers(guildId: string, userIds: string[], muteSeconds: number): Promise<boolean> {
    try {
      if (muteSeconds > 0) {
        await this.memberService.muteMembers(guildId, userIds, muteSeconds);
        plugin.logger.info(`QQ Bot ${this.$id} 禁言成员 ${userIds.join(',')} ${muteSeconds}秒（频道 ${guildId}）`);
      } else {
        await this.memberService.unmuteMembers(guildId, userIds);
        plugin.logger.info(`QQ Bot ${this.$id} 解除成员 ${userIds.join(',')} 禁言（频道 ${guildId}）`);
      }
      return true;
    } catch (error) {
      plugin.logger.error(`QQ Bot ${this.$id} 禁言操作失败:`, error);
      throw error;
    }
  }

  /**
   * 全员禁言
   * @param guildId 频道 ID
   * @param muteSeconds 禁言时长（秒），0 表示解除禁言
   */
  async muteAll(guildId: string, muteSeconds: number): Promise<boolean> {
    try {
      if (muteSeconds > 0) {
        await this.guildService.mute(guildId, muteSeconds);
        plugin.logger.info(`QQ Bot ${this.$id} 开启全员禁言（频道 ${guildId}）`);
      } else {
        await this.guildService.unmute(guildId);
        plugin.logger.info(`QQ Bot ${this.$id} 关闭全员禁言（频道 ${guildId}）`);
      }
      return true;
    } catch (error) {
      plugin.logger.error(`QQ Bot ${this.$id} 全员禁言操作失败:`, error);
      throw error;
    }
  }
}

class QQAdapter extends Adapter<QQBot<ReceiverMode>> {
  constructor(plugin: Plugin) {
    super(plugin, "qq", []);
  }

  createBot(config: QQBotConfig<ReceiverMode>): QQBot<ReceiverMode> {
    return new QQBot(this, config);
  }

  async start(): Promise<void> {
    this.registerQQTools();
    this.declareSkill({
      description: 'QQ 频道管理能力，包括频道/子频道管理、成员管理（踢人、禁言）、身份组管理（创建、分配、撤销角色）、频道信息查询、子频道详情、单成员详情。',
      keywords: ['QQ', '频道', '频道管理', '身份组', '子频道详情', '成员详情'],
      tags: ['qq', '频道管理', '社交平台'],
      conventions: '频道和用户均使用字符串 ID 标识。guild_id 为频道 ID，channel_id 为子频道 ID。调用工具时 bot 参数应填当前上下文的 Bot ID。',
    });
    await super.start();
  }

  /**
   * 注册 QQ 官方平台频道管理工具
   */
  private registerQQTools(): void {
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

    // 获取频道信息工具
    this.addTool({
      name: 'qq_guild_info',
      description: '获取 QQ 频道详细信息',
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
        return await bot.getGuildInfo(guild_id);
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

    // 获取频道成员列表工具
    this.addTool({
      name: 'qq_list_members',
      description: '获取 QQ 频道成员列表',
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
        const members = await bot.getGuildMembers(guild_id);
        return { members, count: members.length };
      },
    });

    // 踢出成员工具
    this.addTool({
      name: 'qq_kick_member',
      description: '将成员踢出 QQ 频道（需要管理员权限）',
      parameters: {
        type: 'object',
        properties: {
          bot: { type: 'string', description: 'Bot 名称' },
          guild_id: { type: 'string', description: '频道 ID' },
          user_id: { type: 'string', description: '用户 ID' },
          blacklist: { type: 'boolean', description: '是否加入黑名单，默认 false' },
        },
        required: ['bot', 'guild_id', 'user_id'],
      },
      platforms: ['qq'],
      scopes: ['channel'],
      permissionLevel: 'group_admin',
      execute: async (args) => {
        const { bot: botId, guild_id, user_id, blacklist = false } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const success = await bot.removeGuildMember(guild_id, user_id, blacklist);
        return { success, message: success ? `已将成员 ${user_id} 踢出频道` : '操作失败' };
      },
    });

    // 禁言成员工具
    this.addTool({
      name: 'qq_mute_member',
      description: '禁言 QQ 频道成员（支持批量）',
      parameters: {
        type: 'object',
        properties: {
          bot: { type: 'string', description: 'Bot 名称' },
          guild_id: { type: 'string', description: '频道 ID' },
          user_ids: { type: 'array', items: { type: 'string' }, description: '用户 ID 列表' },
          duration: { type: 'number', description: '禁言时长（秒），0 表示解除禁言，默认 600' },
        },
        required: ['bot', 'guild_id', 'user_ids'],
      },
      platforms: ['qq'],
      scopes: ['channel'],
      permissionLevel: 'group_admin',
      execute: async (args) => {
        const { bot: botId, guild_id, user_ids, duration = 600 } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const success = await bot.muteMembers(guild_id, user_ids, duration);
        return { 
          success, 
          message: success 
            ? (duration > 0 ? `已禁言成员 ${duration} 秒` : `已解除成员的禁言`)
            : '操作失败' 
        };
      },
    });

    // 全员禁言工具
    this.addTool({
      name: 'qq_mute_all',
      description: '开启/关闭 QQ 频道全员禁言',
      parameters: {
        type: 'object',
        properties: {
          bot: { type: 'string', description: 'Bot 名称' },
          guild_id: { type: 'string', description: '频道 ID' },
          duration: { type: 'number', description: '禁言时长（秒），0 表示解除禁言' },
        },
        required: ['bot', 'guild_id', 'duration'],
      },
      platforms: ['qq'],
      scopes: ['channel'],
      permissionLevel: 'group_admin',
      execute: async (args) => {
        const { bot: botId, guild_id, duration } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const success = await bot.muteAll(guild_id, duration);
        return { success, message: success ? (duration > 0 ? '已开启全员禁言' : '已关闭全员禁言') : '操作失败' };
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

    plugin.logger.debug('已注册 QQ 官方平台频道管理工具');
  }
}

// 使用新的 provide() API 注册适配器
provide({
  name: "qq",
  description: "QQ Official Bot Adapter",
  mounted: async (p) => {
    const adapter = new QQAdapter(p);
    await adapter.start();
    return adapter;
  },
  dispose: async (adapter) => {
    await adapter.stop();
  },
});
