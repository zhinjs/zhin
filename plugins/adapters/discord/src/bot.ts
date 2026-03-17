/**
 * Discord Bot 实现 (Gateway)
 */
import {
  Client,
  GatewayIntentBits,
  Message as DiscordMessage,
  TextChannel,
  DMChannel,
  NewsChannel,
  ThreadChannel,
  EmbedBuilder,
  AttachmentBuilder,
  MessageCreateOptions,
  ChannelType,
  REST,
  Routes,
  ApplicationCommandData,
  ChatInputCommandInteraction,
  InteractionType,
  InteractionResponseType,
  GuildMember,
  PermissionsBitField,
} from "discord.js";
import {
  Bot,
  Message,
  SendOptions,
  SendContent,
  MessageSegment,
  segment,
} from "zhin.js";
import type { DiscordGatewayConfig, DiscordChannelMessage } from "./types.js";
import type { DiscordAdapter } from "./adapter.js";
import { createReadStream } from "fs";
import { promises as fs } from "fs";
import path from "path";

export class DiscordBot
  extends Client
  implements Bot<DiscordGatewayConfig, DiscordChannelMessage> {
  private slashCommandHandlers: Map<
    string,
    (interaction: ChatInputCommandInteraction) => Promise<void>
  > = new Map();
  $connected: boolean = false;
  get pluginLogger() {
    return this.adapter.plugin.logger;
  }

  get $id() {
    return this.$config.name;
  }

  constructor(public adapter: DiscordAdapter, public $config: DiscordGatewayConfig) {
    const intents = $config.intents || [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessageReactions,
    ];

    super({ intents });
    this.$connected = false;
  }

  private async handleDiscordMessage(
    msg: DiscordChannelMessage
  ): Promise<void> {
    // 忽略机器人消息
    if (msg.author.bot) return;

    const message = this.$formatMessage(msg);
    this.adapter.emit("message.receive", message);
    this.pluginLogger.debug(
      `${this.$config.name} recv  ${message.$channel.type}(${message.$channel.id}): ${segment.raw(
        message.$content
      )}`
    );
  }

  private async handleSlashCommand(
    interaction: ChatInputCommandInteraction
  ): Promise<void> {
    const commandName = interaction.commandName;
    const handler = this.slashCommandHandlers.get(commandName);

    if (handler) {
      try {
        await handler(interaction);
        this.pluginLogger.info(
          `Executed slash command: /${commandName} by ${interaction.user.tag}`
        );
      } catch (error) {
        this.pluginLogger.error(
          `Error executing slash command /${commandName}:`,
          error
        );

        const errorMessage = "An error occurred while executing this command.";
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({
            content: errorMessage,
            ephemeral: true,
          });
        } else {
          await interaction.reply({ content: errorMessage, ephemeral: true });
        }
      }
    } else {
      this.pluginLogger.warn(`Unknown slash command: /${commandName}`);
      if (!interaction.replied) {
        await interaction.reply({
          content: "Unknown command.",
          ephemeral: true,
        });
      }
    }
  }

  async $connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      // 监听消息事件
      this.on("messageCreate", this.handleDiscordMessage.bind(this));

      // 监听交互事件（Slash Commands）
      if (this.$config.enableSlashCommands) {
        this.on("interactionCreate", async (interaction) => {
          if (interaction.isChatInputCommand()) {
            await this.handleSlashCommand(interaction);
          }
        });
      }

      // 监听就绪事件
      this.once("clientReady", async () => {
        this.$connected = true;
        this.pluginLogger.info(
          `Discord bot ${this.$config.name} connected successfully as ${this.user?.tag}`
        );

        // 设置活动状态
        if (this.$config.defaultActivity) {
          this.user?.setActivity(this.$config.defaultActivity.name, {
            type: this.getActivityType(this.$config.defaultActivity.type),
            url: this.$config.defaultActivity.url,
          });
        }

        // 注册 Slash Commands
        if (this.$config.enableSlashCommands && this.$config.slashCommands) {
          await this.registerSlashCommands();
        }

        resolve();
      });

      // 监听错误事件
      this.on("error", (error) => {
        this.pluginLogger.error("Discord client error:", error);
        this.$connected = false;
        reject(error);
      });

      // 登录
      this.login(this.$config.token).catch((error) => {
        this.pluginLogger.error("Failed to login to Discord:", error);
        this.$connected = false;
        reject(error);
      });
    });
  }

  async $disconnect(): Promise<void> {
    try {
      await this.destroy();
      this.$connected = false;
      this.pluginLogger.info(`Discord bot ${this.$config.name} disconnected`);
    } catch (error) {
      this.pluginLogger.error("Error disconnecting Discord bot:", error);
      throw error;
    }
  }

  $formatMessage(msg: DiscordChannelMessage): Message<DiscordChannelMessage> {
    // 确定聊天类型和ID
    let channelType: "private" | "group" | "channel";
    let channelId: string;

    if (msg.channel.type === ChannelType.DM) {
      channelType = "private";
      channelId = msg.channel.id;
    } else if (msg.channel.type === ChannelType.GroupDM) {
      channelType = "group";
      channelId = msg.channel.id;
    } else {
      channelType = "channel";
      channelId = msg.channel.id;
    }

    // 转换消息内容为 segment 格式
    const content = this.parseMessageContent(msg);

    const result = Message.from(msg, {
      $id: msg.id,
      $adapter: "discord",
      $bot: this.$config.name,
      $sender: {
        id: msg.author.id,
        name: msg.member?.displayName || msg.author.displayName,
      },
      $channel: {
        id: channelId,
        type: channelType,
      },
      $content: content,
      $raw: msg.content,
      $timestamp: msg.createdTimestamp,
      $recall: async () => {
        await msg.delete();
      },
      $reply: async (
        content: SendContent,
        quote?: boolean | string
      ): Promise<string> => {
        if (!Array.isArray(content)) content = [content];

        const sendOptions: MessageCreateOptions = {};

        // 处理回复消息
        if (quote) {
          const replyId = typeof quote === "boolean" ? result.$id : quote;
          try {
            const replyMessage = await msg.channel.messages.fetch(replyId);
            sendOptions.reply = { messageReference: replyMessage };
          } catch (error) {
            this.pluginLogger.warn(
              `Could not find message to reply to: ${replyId}`
            );
          }
        }

        const res = await this.adapter.sendMessage({
          context: "discord",
          bot: this.$config.name,
          id: msg.channel.id,
          type: msg.channel.type as any,
          content: content,
        });
        return res;
      },
    });

    return result;
  }

  // 解析 Discord 消息内容为 segment 格式
  parseMessageContent(msg: DiscordChannelMessage): MessageSegment[] {
    const segments: MessageSegment[] = [];

    // 回复消息处理
    if (msg.reference) {
      segments.push({
        type: "reply",
        data: {
          id: msg.reference.messageId,
          channel_id: msg.reference.channelId,
          guild_id: msg.reference.guildId,
        },
      });
    }

    // 文本消息（包含提及、表情等）
    if (msg.content) {
      segments.push(...this.parseTextContent(msg.content, msg));
    }

    // 附件消息
    for (const attachment of msg.attachments.values()) {
      segments.push(...this.parseAttachment(attachment));
    }

    // Embed 消息
    for (const embed of msg.embeds) {
      segments.push({
        type: "embed",
        data: {
          title: embed.title,
          description: embed.description,
          color: embed.color,
          url: embed.url,
          thumbnail: embed.thumbnail,
          image: embed.image,
          author: embed.author,
          footer: embed.footer,
          fields: embed.fields,
          timestamp: embed.timestamp,
        },
      });
    }

    // 贴纸消息
    for (const sticker of msg.stickers.values()) {
      segments.push({
        type: "sticker",
        data: {
          id: sticker.id,
          name: sticker.name,
          url: sticker.url,
          format: sticker.format,
          tags: sticker.tags,
        },
      });
    }

    return segments.length > 0
      ? segments
      : [{ type: "text", data: { text: "" } }];
  }

  // 解析文本内容，处理提及、频道引用、角色引用等
  parseTextContent(
    content: string,
    msg: DiscordChannelMessage
  ): MessageSegment[] {
    const segments: MessageSegment[] = [];
    let lastIndex = 0;

    // 匹配用户提及 <@!?用户ID>
    const userMentionRegex = /<@!?(\d+)>/g;
    // 匹配频道提及 <#频道ID>
    const channelMentionRegex = /<#(\d+)>/g;
    // 匹配角色提及 <@&角色ID>
    const roleMentionRegex = /<@&(\d+)>/g;
    // 匹配自定义表情 <:名称:ID> 或 <a:名称:ID>
    const emojiRegex = /<a?:(\w+):(\d+)>/g;

    const allMatches: Array<{
      match: RegExpExecArray;
      type: "user" | "channel" | "role" | "emoji";
    }> = [];

    // 收集所有匹配项
    let match;
    while ((match = userMentionRegex.exec(content)) !== null) {
      allMatches.push({ match, type: "user" });
    }
    while ((match = channelMentionRegex.exec(content)) !== null) {
      allMatches.push({ match, type: "channel" });
    }
    while ((match = roleMentionRegex.exec(content)) !== null) {
      allMatches.push({ match, type: "role" });
    }
    while ((match = emojiRegex.exec(content)) !== null) {
      allMatches.push({ match, type: "emoji" });
    }

    // 按位置排序
    allMatches.sort((a, b) => a.match.index! - b.match.index!);

    // 处理每个匹配项
    for (const { match, type } of allMatches) {
      const matchStart = match.index!;
      const matchEnd = matchStart + match[0].length;

      // 添加匹配项前的文本
      if (matchStart > lastIndex) {
        const beforeText = content.slice(lastIndex, matchStart);
        if (beforeText.trim()) {
          segments.push({ type: "text", data: { text: beforeText } });
        }
      }

      // 添加特殊内容段
      switch (type) {
        case "user":
          const userId = match[1];
          const user = msg.mentions.users.get(userId);
          segments.push({
            type: "at",
            data: {
              id: userId,
              name: user?.username || "Unknown",
              text: match[0],
            },
          });
          break;

        case "channel":
          const channelId = match[1];
          const channel = msg.mentions.channels.get(channelId);
          segments.push({
            type: "channel_mention",
            data: {
              id: channelId,
              name: (channel as any)?.name || "unknown-channel",
              text: match[0],
            },
          });
          break;

        case "role":
          const roleId = match[1];
          const role = msg.mentions.roles.get(roleId);
          segments.push({
            type: "role_mention",
            data: {
              id: roleId,
              name: role?.name || "unknown-role",
              text: match[0],
            },
          });
          break;

        case "emoji":
          const emojiName = match[1];
          const emojiId = match[2];
          const isAnimated = match[0].startsWith("<a:");
          segments.push({
            type: "emoji",
            data: {
              id: emojiId,
              name: emojiName,
              animated: isAnimated,
              url: `https://cdn.discordapp.com/emojis/${emojiId}.${isAnimated ? "gif" : "png"
                }`,
              text: match[0],
            },
          });
          break;
      }

      lastIndex = matchEnd;
    }

    // 添加最后剩余的文本
    if (lastIndex < content.length) {
      const remainingText = content.slice(lastIndex);
      if (remainingText.trim()) {
        segments.push({ type: "text", data: { text: remainingText } });
      }
    }

    return segments.length > 0
      ? segments
      : [{ type: "text", data: { text: content } }];
  }

  // 解析附件
  parseAttachment(attachment: any): MessageSegment[] {
    const segments: MessageSegment[] = [];

    if (attachment.contentType?.startsWith("image/")) {
      segments.push({
        type: "image",
        data: {
          id: attachment.id,
          name: attachment.name,
          url: attachment.url,
          proxy_url: attachment.proxyURL,
          size: attachment.size,
          width: attachment.width,
          height: attachment.height,
          content_type: attachment.contentType,
        },
      });
    } else if (attachment.contentType?.startsWith("audio/")) {
      segments.push({
        type: "audio",
        data: {
          id: attachment.id,
          name: attachment.name,
          url: attachment.url,
          proxy_url: attachment.proxyURL,
          size: attachment.size,
          content_type: attachment.contentType,
        },
      });
    } else if (attachment.contentType?.startsWith("video/")) {
      segments.push({
        type: "video",
        data: {
          id: attachment.id,
          name: attachment.name,
          url: attachment.url,
          proxy_url: attachment.proxyURL,
          size: attachment.size,
          width: attachment.width,
          height: attachment.height,
          content_type: attachment.contentType,
        },
      });
    } else {
      segments.push({
        type: "file",
        data: {
          id: attachment.id,
          name: attachment.name,
          url: attachment.url,
          proxy_url: attachment.proxyURL,
          size: attachment.size,
          content_type: attachment.contentType,
        },
      });
    }

    return segments;
  }

  async $sendMessage(options: SendOptions): Promise<string> {
    try {
      const channel = await this.channels.fetch(options.id);
      if (!channel || !channel.isTextBased()) {
        throw new Error(`Channel ${options.id} is not a text channel`);
      }

      const result = await this.sendContentToChannel(
        channel as any,
        options.content
      );
      this.pluginLogger.debug(
        `${this.$config.name} send ${options.type}(${options.id}): ${segment.raw(options.content)}`
      );
      return result.id;
    } catch (error) {
      this.pluginLogger.error("Failed to send Discord message:", error);
      throw error;
    }
  }

  // 发送内容到频道
  async sendContentToChannel(
    channel: TextChannel | DMChannel | NewsChannel | ThreadChannel,
    content: SendContent,
    extraOptions: MessageCreateOptions = {}
  ): Promise<DiscordMessage<boolean>> {
    if (!Array.isArray(content)) content = [content];

    const messageOptions: MessageCreateOptions = { ...extraOptions };
    let textContent = "";
    const embeds: EmbedBuilder[] = [];
    const files: AttachmentBuilder[] = [];

    for (const segment of content) {
      if (typeof segment === "string") {
        textContent += segment;
        continue;
      }

      const { type, data } = segment;

      switch (type) {
        case "text":
          textContent += data.text || "";
          break;

        case "at":
          textContent += `<@${data.id}>`;
          break;

        case "channel_mention":
          textContent += `<#${data.id}>`;
          break;

        case "role_mention":
          textContent += `<@&${data.id}>`;
          break;

        case "emoji":
          textContent += data.animated
            ? `<a:${data.name}:${data.id}>`
            : `<:${data.name}:${data.id}>`;
          break;

        case "image":
        case "audio":
        case "video":
        case "file":
          await this.handleFileSegment(data, files, textContent);
          break;

        case "embed":
          embeds.push(this.createEmbedFromData(data));
          break;

        default:
          // 未知类型作为文本处理
          textContent += data.text || `[${type}]`;
      }
    }

    // 设置消息内容
    if (textContent.trim()) {
      messageOptions.content = textContent.trim();
    }

    if (embeds.length > 0) {
      messageOptions.embeds = embeds.slice(0, 10); // Discord 限制最多10个embed
    }

    if (files.length > 0) {
      messageOptions.files = files;
    }

    // 发送消息
    return await channel.send(messageOptions);
  }
  async $recallMessage(id: string): Promise<void> { }

  // ==================== 服务器管理 API ====================

  /**
   * 踢出成员
   * @param guildId 服务器 ID
   * @param userId 用户 ID
   * @param reason 原因
   */
  async kickMember(guildId: string, userId: string, reason?: string): Promise<boolean> {
    try {
      const guild = await this.guilds.fetch(guildId);
      const member = await guild.members.fetch(userId);
      await member.kick(reason);
      this.pluginLogger.info(`Discord Bot ${this.$id} 踢出成员 ${userId}（服务器 ${guildId}）`);
      return true;
    } catch (error) {
      this.pluginLogger.error(`Discord Bot ${this.$id} 踢出成员失败:`, error);
      throw error;
    }
  }

  /**
   * 封禁成员
   * @param guildId 服务器 ID
   * @param userId 用户 ID
   * @param reason 原因
   * @param deleteMessageDays 删除消息天数
   */
  async banMember(guildId: string, userId: string, reason?: string, deleteMessageDays?: number): Promise<boolean> {
    try {
      const guild = await this.guilds.fetch(guildId);
      await guild.members.ban(userId, { reason, deleteMessageSeconds: deleteMessageDays ? deleteMessageDays * 86400 : undefined });
      this.pluginLogger.info(`Discord Bot ${this.$id} 封禁成员 ${userId}（服务器 ${guildId}）`);
      return true;
    } catch (error) {
      this.pluginLogger.error(`Discord Bot ${this.$id} 封禁成员失败:`, error);
      throw error;
    }
  }

  /**
   * 解除封禁
   * @param guildId 服务器 ID
   * @param userId 用户 ID
   * @param reason 原因
   */
  async unbanMember(guildId: string, userId: string, reason?: string): Promise<boolean> {
    try {
      const guild = await this.guilds.fetch(guildId);
      await guild.members.unban(userId, reason);
      this.pluginLogger.info(`Discord Bot ${this.$id} 解除封禁 ${userId}（服务器 ${guildId}）`);
      return true;
    } catch (error) {
      this.pluginLogger.error(`Discord Bot ${this.$id} 解除封禁失败:`, error);
      throw error;
    }
  }

  /**
   * 超时（禁言）成员
   * @param guildId 服务器 ID
   * @param userId 用户 ID
   * @param duration 超时时长（秒），0 表示取消超时
   * @param reason 原因
   */
  async timeoutMember(guildId: string, userId: string, duration: number = 600, reason?: string): Promise<boolean> {
    try {
      const guild = await this.guilds.fetch(guildId);
      const member = await guild.members.fetch(userId);
      if (duration === 0) {
        await member.timeout(null, reason);
        this.pluginLogger.info(`Discord Bot ${this.$id} 取消成员 ${userId} 超时（服务器 ${guildId}）`);
      } else {
        await member.timeout(duration * 1000, reason);
        this.pluginLogger.info(`Discord Bot ${this.$id} 超时成员 ${userId} ${duration}秒（服务器 ${guildId}）`);
      }
      return true;
    } catch (error) {
      this.pluginLogger.error(`Discord Bot ${this.$id} 超时操作失败:`, error);
      throw error;
    }
  }

  /**
   * 修改成员昵称
   * @param guildId 服务器 ID
   * @param userId 用户 ID
   * @param nickname 新昵称
   */
  async setNickname(guildId: string, userId: string, nickname: string): Promise<boolean> {
    try {
      const guild = await this.guilds.fetch(guildId);
      const member = await guild.members.fetch(userId);
      await member.setNickname(nickname);
      this.pluginLogger.info(`Discord Bot ${this.$id} 设置成员 ${userId} 昵称为 "${nickname}"（服务器 ${guildId}）`);
      return true;
    } catch (error) {
      this.pluginLogger.error(`Discord Bot ${this.$id} 设置昵称失败:`, error);
      throw error;
    }
  }

  /**
   * 添加角色
   * @param guildId 服务器 ID
   * @param userId 用户 ID
   * @param roleId 角色 ID
   */
  async addRole(guildId: string, userId: string, roleId: string): Promise<boolean> {
    try {
      const guild = await this.guilds.fetch(guildId);
      const member = await guild.members.fetch(userId);
      await member.roles.add(roleId);
      this.pluginLogger.info(`Discord Bot ${this.$id} 给成员 ${userId} 添加角色 ${roleId}（服务器 ${guildId}）`);
      return true;
    } catch (error) {
      this.pluginLogger.error(`Discord Bot ${this.$id} 添加角色失败:`, error);
      throw error;
    }
  }

  /**
   * 移除角色
   * @param guildId 服务器 ID
   * @param userId 用户 ID
   * @param roleId 角色 ID
   */
  async removeRole(guildId: string, userId: string, roleId: string): Promise<boolean> {
    try {
      const guild = await this.guilds.fetch(guildId);
      const member = await guild.members.fetch(userId);
      await member.roles.remove(roleId);
      this.pluginLogger.info(`Discord Bot ${this.$id} 移除成员 ${userId} 的角色 ${roleId}（服务器 ${guildId}）`);
      return true;
    } catch (error) {
      this.pluginLogger.error(`Discord Bot ${this.$id} 移除角色失败:`, error);
      throw error;
    }
  }

  /**
   * 获取服务器角色列表
   * @param guildId 服务器 ID
   */
  async getRoles(guildId: string): Promise<any[]> {
    try {
      const guild = await this.guilds.fetch(guildId);
      await guild.roles.fetch();
      return guild.roles.cache.map(role => ({
        id: role.id,
        name: role.name,
        color: role.hexColor,
        position: role.position,
        permissions: role.permissions.bitfield.toString(),
      }));
    } catch (error) {
      this.pluginLogger.error(`Discord Bot ${this.$id} 获取角色列表失败:`, error);
      throw error;
    }
  }

  /**
   * 获取成员列表
   * @param guildId 服务器 ID
   * @param limit 数量限制
   */
  async getMembers(guildId: string, limit: number = 100): Promise<any[]> {
    try {
      const guild = await this.guilds.fetch(guildId);
      const members = await guild.members.fetch({ limit });
      return Array.from(members.values()).map(member => ({
        id: member.id,
        username: member.user.username,
        nickname: member.nickname,
        roles: member.roles.cache.map(r => r.id),
        joined_at: member.joinedAt?.toISOString(),
      }));
    } catch (error) {
      this.pluginLogger.error(`Discord Bot ${this.$id} 获取成员列表失败:`, error);
      throw error;
    }
  }

  /**
   * 获取服务器信息
   * @param guildId 服务器 ID
   */
  async getGuildInfo(guildId: string): Promise<any> {
    try {
      const guild = await this.guilds.fetch(guildId);
      return {
        id: guild.id,
        name: guild.name,
        icon: guild.iconURL(),
        owner_id: guild.ownerId,
        member_count: guild.memberCount,
        created_at: guild.createdAt?.toISOString(),
      };
    } catch (error) {
      this.pluginLogger.error(`Discord Bot ${this.$id} 获取服务器信息失败:`, error);
      throw error;
    }
  }

  async createThread(channelId: string, name: string, messageId?: string, autoArchiveDuration?: number): Promise<ThreadChannel> {
    try {
      const channel = await this.channels.fetch(channelId);
      if (!channel || !('threads' in channel)) throw new Error(`Channel ${channelId} 不支持创建帖子`);
      const options: any = { name, autoArchiveDuration: autoArchiveDuration || 1440 };
      if (messageId) options.startMessage = messageId;
      const thread = await (channel as TextChannel).threads.create(options);
      this.pluginLogger.info(`Discord Bot ${this.$id} 创建帖子 "${name}" (channel ${channelId})`);
      return thread;
    } catch (error) {
      this.pluginLogger.error(`Discord Bot ${this.$id} 创建帖子失败:`, error);
      throw error;
    }
  }

  async addReaction(channelId: string, messageId: string, emoji: string): Promise<void> {
    try {
      const channel = await this.channels.fetch(channelId);
      if (!channel || !channel.isTextBased()) throw new Error(`Channel ${channelId} 不是文本频道`);
      const message = await (channel as TextChannel).messages.fetch(messageId);
      await message.react(emoji);
      this.pluginLogger.info(`Discord Bot ${this.$id} 添加反应 ${emoji} (message ${messageId})`);
    } catch (error) {
      this.pluginLogger.error(`Discord Bot ${this.$id} 添加反应失败:`, error);
      throw error;
    }
  }

  async sendEmbed(channelId: string, embedData: { title?: string; description?: string; color?: number; url?: string; fields?: { name: string; value: string; inline?: boolean }[] }): Promise<DiscordMessage<boolean>> {
    try {
      const channel = await this.channels.fetch(channelId);
      if (!channel || !channel.isTextBased()) throw new Error(`Channel ${channelId} 不是文本频道`);
      const embed = this.createEmbedFromData(embedData);
      const msg = await (channel as TextChannel).send({ embeds: [embed] });
      this.pluginLogger.info(`Discord Bot ${this.$id} 发送 Embed 到 ${channelId}`);
      return msg;
    } catch (error) {
      this.pluginLogger.error(`Discord Bot ${this.$id} 发送 Embed 失败:`, error);
      throw error;
    }
  }

  async createForumPost(channelId: string, name: string, content: string, tags?: string[]): Promise<ThreadChannel> {
    try {
      const channel = await this.channels.fetch(channelId);
      if (!channel || channel.type !== ChannelType.GuildForum) throw new Error(`Channel ${channelId} 不是论坛频道`);
      const forumChannel = channel as any;
      const options: any = {
        name,
        message: { content },
      };
      if (tags?.length && forumChannel.availableTags?.length) {
        const tagIds = forumChannel.availableTags
          .filter((t: any) => tags.includes(t.name))
          .map((t: any) => t.id);
        if (tagIds.length) options.appliedTags = tagIds;
      }
      const thread = await forumChannel.threads.create(options);
      this.pluginLogger.info(`Discord Bot ${this.$id} 创建论坛帖 "${name}" (channel ${channelId})`);
      return thread;
    } catch (error) {
      this.pluginLogger.error(`Discord Bot ${this.$id} 创建论坛帖失败:`, error);
      throw error;
    }
  }

  // 处理文件段
  async handleFileSegment(
    data: any,
    files: AttachmentBuilder[],
    textContent: string
  ): Promise<void> {
    if (data.file && (await this.fileExists(data.file))) {
      // 本地文件
      files.push(
        new AttachmentBuilder(createReadStream(data.file), {
          name: data.name || path.basename(data.file),
        })
      );
    } else if (data.url) {
      // URL 文件
      files.push(
        new AttachmentBuilder(data.url, {
          name: data.name || "attachment",
        })
      );
    } else if (data.buffer) {
      // Buffer 数据
      files.push(
        new AttachmentBuilder(data.buffer, {
          name: data.name || "attachment",
        })
      );
    }
  }

  // 从数据创建 Embed
  createEmbedFromData(data: any): EmbedBuilder {
    const embed = new EmbedBuilder();

    if (data.title) embed.setTitle(data.title);
    if (data.description) embed.setDescription(data.description);
    if (data.color) embed.setColor(data.color);
    if (data.url) embed.setURL(data.url);
    if (data.thumbnail?.url) embed.setThumbnail(data.thumbnail.url);
    if (data.image?.url) embed.setImage(data.image.url);
    if (data.author) embed.setAuthor(data.author);
    if (data.footer) embed.setFooter(data.footer);
    if (data.timestamp) embed.setTimestamp(new Date(data.timestamp));
    if (data.fields && Array.isArray(data.fields)) {
      embed.addFields(data.fields);
    }

    return embed;
  }

  // 工具方法：获取活动类型
  private getActivityType(type: string) {
    const activityTypes = {
      PLAYING: 0,
      STREAMING: 1,
      LISTENING: 2,
      WATCHING: 3,
      COMPETING: 5,
    };
    return activityTypes[type as keyof typeof activityTypes] || 0;
  }

  // 注册 Slash Commands
  private async registerSlashCommands(): Promise<void> {
    if (!this.$config.slashCommands || !this.user) return;

    try {
      const rest = new REST({ version: "10" }).setToken(this.$config.token);

      if (this.$config.globalCommands) {
        // 注册全局命令
        await rest.put(Routes.applicationCommands(this.user.id), {
          body: this.$config.slashCommands,
        });
        this.pluginLogger.info("Successfully registered global slash commands");
      } else {
        // 为每个服务器注册命令
        for (const guild of this.guilds.cache.values()) {
          await rest.put(
            Routes.applicationGuildCommands(this.user.id, guild.id),
            { body: this.$config.slashCommands }
          );
        }
        this.pluginLogger.info("Successfully registered guild slash commands");
      }
    } catch (error) {
      this.pluginLogger.error("Failed to register slash commands:", error);
    }
  }

  // 添加 Slash Command 处理器
  addSlashCommandHandler(
    commandName: string,
    handler: (interaction: ChatInputCommandInteraction) => Promise<void>
  ) {
    this.slashCommandHandlers.set(commandName, handler);
  }

  // 移除 Slash Command 处理器
  removeSlashCommandHandler(commandName: string): boolean {
    return this.slashCommandHandlers.delete(commandName);
  }

  // 工具方法：检查文件是否存在
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  // 静态方法：格式化内容为文本（用于日志显示）
  static formatContentToText(content: SendContent): string {
    if (!Array.isArray(content)) content = [content];

    return content
      .map((segment) => {
        if (typeof segment === "string") return segment;

        switch (segment.type) {
          case "text":
            return segment.data.text || "";
          case "at":
            return `@${segment.data.name || segment.data.id}`;
          case "channel_mention":
            return `#${segment.data.name}`;
          case "role_mention":
            return `@${segment.data.name}`;
          case "image":
            return "[图片]";
          case "audio":
            return "[音频]";
          case "video":
            return "[视频]";
          case "file":
            return "[文件]";
          case "embed":
            return "[嵌入消息]";
          case "emoji":
            return `:${segment.data.name}:`;
          default:
            return `[${segment.type}]`;
        }
      })
      .join("");
  }
}

// ================================================================================================
// DiscordInteractionsBot 类（Interactions 端点模式）
// ================================================================================================

import * as nacl from "tweetnacl";

