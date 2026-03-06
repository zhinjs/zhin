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
  createGroupManagementTools,
  GROUP_MANAGEMENT_SKILL_KEYWORDS,
  GROUP_MANAGEMENT_SKILL_TAGS,
  type IGroupManagement,
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
    this.declareSkill({
      description:
        'QQ 官方机器人群管理：踢人、禁言、设管理员、改群名、查成员等。仅有昵称时请先 list_members 查 user_id 再操作。',
      keywords: GROUP_MANAGEMENT_SKILL_KEYWORDS,
      tags: GROUP_MANAGEMENT_SKILL_TAGS,
    });
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

    plugin.logger.debug('已注册 QQ 官方平台频道管理工具');
  }
}

// 使用新的 provide() API 注册适配器
provide({
  name: "qq",
  description: "QQ Official Bot Adapter",
  mounted: async (p: Plugin) => {
    const adapter = new QQAdapter(p);
    await adapter.start();
    return adapter;
  },
  dispose: async (adapter) => {
    await adapter.stop();
  },
});
