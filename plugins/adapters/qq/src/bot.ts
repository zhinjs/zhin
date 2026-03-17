/**
 * QQ 官方 Bot 实现
 */
import {
  Bot,
  PrivateMessageEvent,
  GroupMessageEvent,
} from "qq-official-bot";
import path from "path";
import {
  Bot as ZhinBot,
  Message,
  SendOptions,
  SendContent,
  segment,
} from "zhin.js";
import type { QQBotConfig, ReceiverMode, ApplicationPlatform } from "./types.js";
import type { QQAdapter } from "./adapter.js";


export class QQBot<T extends ReceiverMode, M extends ApplicationPlatform = ApplicationPlatform>
  extends Bot
  implements ZhinBot<QQBotConfig<T, M>, PrivateMessageEvent | GroupMessageEvent>
{
  $connected: boolean = false;
  declare $config: QQBotConfig<T, M>;

  get pluginLogger() {
    return this.adapter.plugin.logger;
  }

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
    this.pluginLogger.debug(`${this.$config.name} recv  ${message.$channel.type}(${message.$channel.id}):${segment.raw(message.$content)}`);
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
          this.pluginLogger.debug(`${this.$config.name} send ${options.type}(${options.id}):${segment.raw(options.content)}`);
          return `direct-${options.id}:${result.id.toString()}`;
        } else {
          const result = await this.sendPrivateMessage(options.id, options.content);
          this.pluginLogger.debug(`${this.$config.name} send ${options.type}(${options.id}):${segment.raw(options.content)}`);
          return `private-${options.id}:${result.id.toString()}`;
        }
      }
      case "group": {
        const result = await this.sendGroupMessage(options.id, options.content);
        this.pluginLogger.debug(`${this.$config.name} send ${options.type}(${options.id}):${segment.raw(options.content)}`);
        return `group-${options.id}:${result.id.toString()}`;
      }
      case "channel": {
        const result = await this.sendGuildMessage(options.id, options.content);
        this.pluginLogger.debug(`${this.$config.name} send ${options.type}(${options.id}):${segment.raw(options.content)}`);
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
      this.pluginLogger.error(`QQ Bot ${this.$id} 获取频道列表失败:`, error);
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
      this.pluginLogger.error(`QQ Bot ${this.$id} 获取频道详情失败:`, error);
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
      this.pluginLogger.error(`QQ Bot ${this.$id} 获取子频道列表失败:`, error);
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
      this.pluginLogger.error(`QQ Bot ${this.$id} 获取子频道详情失败:`, error);
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
      this.pluginLogger.error(`QQ Bot ${this.$id} 获取频道成员列表失败:`, error);
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
      this.pluginLogger.error(`QQ Bot ${this.$id} 获取成员详情失败:`, error);
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
      this.pluginLogger.info(`QQ Bot ${this.$id} 踢出成员 ${userId}（频道 ${guildId}）`);
      return true;
    } catch (error) {
      this.pluginLogger.error(`QQ Bot ${this.$id} 踢出成员失败:`, error);
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
      this.pluginLogger.error(`QQ Bot ${this.$id} 获取角色列表失败:`, error);
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
      this.pluginLogger.info(`QQ Bot ${this.$id} 创建角色 "${name}"（频道 ${guildId}）`);
      return result;
    } catch (error) {
      this.pluginLogger.error(`QQ Bot ${this.$id} 创建角色失败:`, error);
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
      this.pluginLogger.info(`QQ Bot ${this.$id} 给成员 ${userId} 添加角色 ${roleId}（频道 ${guildId}）`);
      return true;
    } catch (error) {
      this.pluginLogger.error(`QQ Bot ${this.$id} 添加角色失败:`, error);
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
      this.pluginLogger.info(`QQ Bot ${this.$id} 移除成员 ${userId} 的角色 ${roleId}（频道 ${guildId}）`);
      return true;
    } catch (error) {
      this.pluginLogger.error(`QQ Bot ${this.$id} 移除角色失败:`, error);
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
        this.pluginLogger.info(`QQ Bot ${this.$id} 禁言成员 ${userIds.join(',')} ${muteSeconds}秒（频道 ${guildId}）`);
      } else {
        await this.memberService.unmuteMembers(guildId, userIds);
        this.pluginLogger.info(`QQ Bot ${this.$id} 解除成员 ${userIds.join(',')} 禁言（频道 ${guildId}）`);
      }
      return true;
    } catch (error) {
      this.pluginLogger.error(`QQ Bot ${this.$id} 禁言操作失败:`, error);
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
        this.pluginLogger.info(`QQ Bot ${this.$id} 开启全员禁言（频道 ${guildId}）`);
      } else {
        await this.guildService.unmute(guildId);
        this.pluginLogger.info(`QQ Bot ${this.$id} 关闭全员禁言（频道 ${guildId}）`);
      }
      return true;
    } catch (error) {
      this.pluginLogger.error(`QQ Bot ${this.$id} 全员禁言操作失败:`, error);
      throw error;
    }
  }
}
