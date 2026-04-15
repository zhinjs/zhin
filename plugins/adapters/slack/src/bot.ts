/**
 * Slack Bot 实现
 */
import { App as SlackApp, LogLevel } from "@slack/bolt";
import { WebClient, type ChatPostMessageArguments } from "@slack/web-api";
import {
  Bot,
  Message,
  SendOptions,
  SendContent,
  MessageSegment,
  segment,
} from "zhin.js";
import type { SlackBotConfig, SlackMessageEvent } from "./types.js";
import type { SlackAdapter } from "./adapter.js";


export class SlackBot implements Bot<SlackBotConfig, SlackMessageEvent> {
  $connected: boolean;
  private app: SlackApp;
  private client: WebClient;

  get logger() {
    return this.adapter.plugin.logger;
  }

  get $id() {
    return this.$config.name;
  }

  constructor(public adapter: SlackAdapter, public $config: SlackBotConfig) {
    this.$connected = false;

    // Initialize Slack app
    if ($config.socketMode && $config.appToken) {
      // Socket Mode
      this.app = new SlackApp({
        token: $config.token,
        signingSecret: $config.signingSecret,
        appToken: $config.appToken,
        socketMode: true,
        logLevel: $config.logLevel || LogLevel.INFO,
      });
    } else {
      // HTTP Mode
      this.app = new SlackApp({
        token: $config.token,
        signingSecret: $config.signingSecret,
        socketMode: false,
        logLevel: $config.logLevel || LogLevel.INFO,
      });
    }

    this.client = new WebClient($config.token);
  }

  async $connect(): Promise<void> {
    try {
      // Set up message event handler
      this.app.message(async ({ message, say }) => {
        await this.handleSlackMessage(message as SlackMessageEvent);
      });

      // Set up app mention handler
      this.app.event("app_mention", async ({ event, say }) => {
        await this.handleSlackMessage(event as any);
      });

      // Start the app
      const port = this.$config.port || 3000;
      if (this.$config.socketMode) {
        await this.app.start();
      } else {
        await this.app.start(port);
      }

      this.$connected = true;

      // Get bot info
      const authTest = await this.client.auth.test();
      this.logger.info(
        `Slack bot ${this.$config.name} connected successfully as @${authTest.user}`
      );

      if (!this.$config.socketMode) {
        this.logger.info(`Slack bot listening on port ${port}`);
      }
    } catch (error) {
      this.logger.error("Failed to connect Slack bot:", error);
      this.$connected = false;
      throw error;
    }
  }

  async $disconnect(): Promise<void> {
    try {
      await this.app.stop();
      this.$connected = false;
      this.logger.info(`Slack bot ${this.$config.name} disconnected`);
    } catch (error) {
      this.logger.error("Error disconnecting Slack bot:", error);
      throw error;
    }
  }

  private async handleSlackMessage(msg: SlackMessageEvent): Promise<void> {
    // Ignore bot messages and message changes
    if ("subtype" in msg && (msg.subtype === "bot_message" || msg.subtype === "message_changed")) {
      return;
    }

    const message = this.$formatMessage(msg);
    this.adapter.emit("message.receive", message);
    this.logger.debug(
      `${this.$config.name} recv  ${message.$channel.type}(${message.$channel.id}): ${segment.raw(message.$content)}`
    );
  }

  $formatMessage(msg: SlackMessageEvent): Message<SlackMessageEvent> {
    // Determine channel type based on channel ID
    const channelType = "channel_type" in msg && msg.channel_type === "im" ? "private" : "group";
    const channelId = msg.channel;

    // Parse message content
    const content = this.parseMessageContent(msg);

    // Extract user info safely
    const userId = ("user" in msg ? msg.user : "") || "";
    const userName = ("username" in msg ? msg.username : null) || userId || "Unknown";
    const messageText = ("text" in msg ? msg.text : "") || "";

    const result = Message.from(msg, {
      $id: msg.ts,
      $adapter: "slack",
      $bot: this.$config.name,
      $sender: {
        id: userId,
        name: userName,
      },
      $channel: {
        id: channelId,
        type: channelType,
      },
      $content: content,
      $raw: messageText,
      $timestamp: parseFloat(msg.ts) * 1000,
      $recall: async () => {
        try {
          await this.client.chat.delete({
            channel: channelId,
            ts: result.$id,
          });
        } catch (error) {
          this.logger.error("Error recalling Slack message:", error);
          throw error;
        }
      },
      $reply: async (
        content: SendContent,
        quote?: boolean | string
      ): Promise<string> => {
        if (!Array.isArray(content)) content = [content];

        const sendOptions: Partial<ChatPostMessageArguments> = {
          channel: channelId,
        };

        // Handle thread reply
        if (quote) {
          const threadTs = typeof quote === "boolean" ? result.$id : quote;
          sendOptions.thread_ts = threadTs;
        }

        return  await this.adapter.sendMessage({
          context: "slack",
          bot: this.$config.name,
          id: channelId,
          type: "channel",
          content: content,
        });
      },
    });

    return result;
  }

  private parseMessageContent(msg: SlackMessageEvent): MessageSegment[] {
    const segments: MessageSegment[] = [];

    // Handle text
    if ("text" in msg && msg.text) {
      // Parse Slack formatting
      segments.push(...this.parseSlackText(msg.text));
    }

    // Handle files
    if ("files" in msg && msg.files) {
      for (const file of msg.files) {
        if (file.mimetype?.startsWith("image/")) {
          segments.push({
            type: "image",
            data: {
              id: file.id,
              name: file.name,
              url: file.url_private || file.permalink,
              size: file.size,
              mimetype: file.mimetype,
            },
          });
        } else if (file.mimetype?.startsWith("video/")) {
          segments.push({
            type: "video",
            data: {
              id: file.id,
              name: file.name,
              url: file.url_private || file.permalink,
              size: file.size,
              mimetype: file.mimetype,
            },
          });
        } else if (file.mimetype?.startsWith("audio/")) {
          segments.push({
            type: "audio",
            data: {
              id: file.id,
              name: file.name,
              url: file.url_private || file.permalink,
              size: file.size,
              mimetype: file.mimetype,
            },
          });
        } else {
          segments.push({
            type: "file",
            data: {
              id: file.id,
              name: file.name,
              url: file.url_private || file.permalink,
              size: file.size,
              mimetype: file.mimetype,
            },
          });
        }
      }
    }

    // Handle attachments
    if ("attachments" in msg && msg.attachments) {
      for (const attachment of msg.attachments) {
        if (attachment.image_url) {
          segments.push({
            type: "image",
            data: {
              url: attachment.image_url,
              title: attachment.title,
              text: attachment.text,
            },
          });
        }
      }
    }

    return segments.length > 0
      ? segments
      : [{ type: "text", data: { text: "" } }];
  }

  private parseSlackText(text: string): MessageSegment[] {
    const segments: MessageSegment[] = [];
    let lastIndex = 0;

    // Match user mentions <@U12345678>
    const userMentionRegex = /<@([UW][A-Z0-9]+)(?:\|([^>]+))?>/g;
    // Match channel mentions <#C12345678|general>
    const channelMentionRegex = /<#([C][A-Z0-9]+)(?:\|([^>]+))?>/g;
    // Match links <http://example.com|Example>
    const linkRegex = /<(https?:\/\/[^|>]+)(?:\|([^>]+))?>/g;

    const allMatches: Array<{
      match: RegExpExecArray;
      type: "user" | "channel" | "link";
    }> = [];

    // Collect all matches
    let match;
    while ((match = userMentionRegex.exec(text)) !== null) {
      allMatches.push({ match, type: "user" });
    }
    while ((match = channelMentionRegex.exec(text)) !== null) {
      allMatches.push({ match, type: "channel" });
    }
    while ((match = linkRegex.exec(text)) !== null) {
      allMatches.push({ match, type: "link" });
    }

    // Sort by position
    allMatches.sort((a, b) => a.match.index! - b.match.index!);

    // Process matches
    for (const { match, type } of allMatches) {
      const matchStart = match.index!;
      const matchEnd = matchStart + match[0].length;

      // Add text before match
      if (matchStart > lastIndex) {
        const beforeText = text.slice(lastIndex, matchStart);
        if (beforeText.trim()) {
          segments.push({ type: "text", data: { text: beforeText } });
        }
      }

      // Add special segment
      switch (type) {
        case "user":
          segments.push({
            type: "at",
            data: {
              id: match[1],
              name: match[2] || match[1],
              text: match[0],
            },
          });
          break;

        case "channel":
          segments.push({
            type: "channel_mention",
            data: {
              id: match[1],
              name: match[2] || match[1],
              text: match[0],
            },
          });
          break;

        case "link":
          segments.push({
            type: "link",
            data: {
              url: match[1],
              text: match[2] || match[1],
            },
          });
          break;
      }

      lastIndex = matchEnd;
    }

    // Add remaining text
    if (lastIndex < text.length) {
      const remainingText = text.slice(lastIndex);
      if (remainingText.trim()) {
        segments.push({ type: "text", data: { text: remainingText } });
      }
    }

    return segments.length > 0
      ? segments
      : [{ type: "text", data: { text } }];
  }

  async $sendMessage(options: SendOptions): Promise<string> {
    try {
      const result = await this.sendContentToChannel(
        options.id,
        options.content
      );
      this.logger.debug(
        `${this.$config.name} send ${options.type}(${options.id}): ${segment.raw(options.content)}`
      );
      return result.ts || "";
    } catch (error) {
      this.logger.error("Failed to send Slack message:", error);
      throw error;
    }
  }

  private async sendContentToChannel(
    channel: string,
    content: SendContent,
    extraOptions: Partial<ChatPostMessageArguments> = {}
  ): Promise<any> {
    if (!Array.isArray(content)) content = [content];

    let textContent = "";
    const attachments: any[] = [];

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

        case "link":
          if (data.text && data.text !== data.url) {
            textContent += `<${data.url}|${data.text}>`;
          } else {
            textContent += `<${data.url}>`;
          }
          break;

        case "image":
          if (data.url) {
            attachments.push({
              image_url: data.url,
              title: data.name || data.title,
            });
          }
          break;

        case "file":
          // Files need to be uploaded separately
          if (data.file) {
            try {
              await this.client.files.upload({
                channels: channel,
                file: data.file,
                filename: data.name,
              });
            } catch (error) {
              this.logger.error("Failed to upload file:", error);
            }
          }
          break;

        default:
          textContent += data.text || `[${type}]`;
      }
    }

    // Send message
    const messageOptions: any = {
      channel,
      text: textContent.trim() || "Message",
      ...extraOptions,
    };

    if (attachments.length > 0) {
      messageOptions.attachments = attachments;
    }

    const result = await this.client.chat.postMessage(messageOptions as ChatPostMessageArguments);
    return result.message || {};
  }

  async $recallMessage(id: string): Promise<void> {
    // Slack requires both channel and ts (timestamp) to delete a message
    // The Bot interface only provides message ID (ts), making recall impossible  
    // Users should use message.$recall() instead, which has the full context
    throw new Error(
      "SlackBot.$recallMessage: Message recall not supported without channel information. " +
      "Use message.$recall() method instead, which contains the required context."
    );
  }

  // ==================== 工作区管理 API ====================

  /**
   * 邀请用户到频道
   * @param channel 频道 ID
   * @param users 用户 ID 列表
   */
  async inviteToChannel(channel: string, users: string[]): Promise<boolean> {
    try {
      await this.client.conversations.invite({ channel, users: users.join(',') });
      this.logger.info(`Slack Bot ${this.$id} 邀请用户 ${users.join(',')} 到频道 ${channel}`);
      return true;
    } catch (error) {
      this.logger.error(`Slack Bot ${this.$id} 邀请用户失败:`, error);
      throw error;
    }
  }

  /**
   * 从频道踢出用户
   * @param channel 频道 ID
   * @param user 用户 ID
   */
  async kickFromChannel(channel: string, user: string): Promise<boolean> {
    try {
      await this.client.conversations.kick({ channel, user });
      this.logger.info(`Slack Bot ${this.$id} 将用户 ${user} 从频道 ${channel} 踢出`);
      return true;
    } catch (error) {
      this.logger.error(`Slack Bot ${this.$id} 踢出用户失败:`, error);
      throw error;
    }
  }

  /**
   * 设置频道话题
   * @param channel 频道 ID
   * @param topic 话题
   */
  async setChannelTopic(channel: string, topic: string): Promise<boolean> {
    try {
      await this.client.conversations.setTopic({ channel, topic });
      this.logger.info(`Slack Bot ${this.$id} 设置频道 ${channel} 话题为 "${topic}"`);
      return true;
    } catch (error) {
      this.logger.error(`Slack Bot ${this.$id} 设置话题失败:`, error);
      throw error;
    }
  }

  /**
   * 设置频道目的
   * @param channel 频道 ID
   * @param purpose 目的
   */
  async setChannelPurpose(channel: string, purpose: string): Promise<boolean> {
    try {
      await this.client.conversations.setPurpose({ channel, purpose });
      this.logger.info(`Slack Bot ${this.$id} 设置频道 ${channel} 目的`);
      return true;
    } catch (error) {
      this.logger.error(`Slack Bot ${this.$id} 设置目的失败:`, error);
      throw error;
    }
  }

  /**
   * 归档频道
   * @param channel 频道 ID
   */
  async archiveChannel(channel: string): Promise<boolean> {
    try {
      await this.client.conversations.archive({ channel });
      this.logger.info(`Slack Bot ${this.$id} 归档频道 ${channel}`);
      return true;
    } catch (error) {
      this.logger.error(`Slack Bot ${this.$id} 归档频道失败:`, error);
      throw error;
    }
  }

  /**
   * 取消归档频道
   * @param channel 频道 ID
   */
  async unarchiveChannel(channel: string): Promise<boolean> {
    try {
      await this.client.conversations.unarchive({ channel });
      this.logger.info(`Slack Bot ${this.$id} 取消归档频道 ${channel}`);
      return true;
    } catch (error) {
      this.logger.error(`Slack Bot ${this.$id} 取消归档失败:`, error);
      throw error;
    }
  }

  /**
   * 重命名频道
   * @param channel 频道 ID
   * @param name 新名称
   */
  async renameChannel(channel: string, name: string): Promise<boolean> {
    try {
      await this.client.conversations.rename({ channel, name });
      this.logger.info(`Slack Bot ${this.$id} 重命名频道 ${channel} 为 "${name}"`);
      return true;
    } catch (error) {
      this.logger.error(`Slack Bot ${this.$id} 重命名频道失败:`, error);
      throw error;
    }
  }

  /**
   * 获取频道成员列表
   * @param channel 频道 ID
   */
  async getChannelMembers(channel: string): Promise<string[]> {
    try {
      const result = await this.client.conversations.members({ channel });
      return result.members || [];
    } catch (error) {
      this.logger.error(`Slack Bot ${this.$id} 获取成员列表失败:`, error);
      throw error;
    }
  }

  /**
   * 获取频道信息
   * @param channel 频道 ID
   */
  async getChannelInfo(channel: string): Promise<any> {
    try {
      const result = await this.client.conversations.info({ channel });
      return result.channel;
    } catch (error) {
      this.logger.error(`Slack Bot ${this.$id} 获取频道信息失败:`, error);
      throw error;
    }
  }

  /**
   * 获取用户信息
   * @param user 用户 ID
   */
  async getUserInfo(user: string): Promise<any> {
    try {
      const result = await this.client.users.info({ user });
      return result.user;
    } catch (error) {
      this.logger.error(`Slack Bot ${this.$id} 获取用户信息失败:`, error);
      throw error;
    }
  }

  /**
   * 添加消息反应
   * @param channel 频道 ID
   * @param timestamp 消息时间戳
   * @param name 表情名称
   */
  async addReaction(channel: string, timestamp: string, name: string): Promise<boolean> {
    try {
      await this.client.reactions.add({ channel, timestamp, name });
      this.logger.info(`Slack Bot ${this.$id} 添加反应 :${name}: 到消息`);
      return true;
    } catch (error) {
      this.logger.error(`Slack Bot ${this.$id} 添加反应失败:`, error);
      throw error;
    }
  }

  /**
   * 移除消息反应
   * @param channel 频道 ID
   * @param timestamp 消息时间戳
   * @param name 表情名称
   */
  async removeReaction(channel: string, timestamp: string, name: string): Promise<boolean> {
    try {
      await this.client.reactions.remove({ channel, timestamp, name });
      this.logger.info(`Slack Bot ${this.$id} 移除反应 :${name}:`);
      return true;
    } catch (error) {
      this.logger.error(`Slack Bot ${this.$id} 移除反应失败:`, error);
      throw error;
    }
  }

  /**
   * 置顶消息
   * @param channel 频道 ID
   * @param timestamp 消息时间戳
   */
  async pinMessage(channel: string, timestamp: string): Promise<boolean> {
    try {
      await this.client.pins.add({ channel, timestamp });
      this.logger.info(`Slack Bot ${this.$id} 置顶消息（频道 ${channel}）`);
      return true;
    } catch (error) {
      this.logger.error(`Slack Bot ${this.$id} 置顶消息失败:`, error);
      throw error;
    }
  }

  /**
   * 取消置顶消息
   * @param channel 频道 ID
   * @param timestamp 消息时间戳
   */
  async unpinMessage(channel: string, timestamp: string): Promise<boolean> {
    try {
      await this.client.pins.remove({ channel, timestamp });
      this.logger.info(`Slack Bot ${this.$id} 取消置顶消息`);
      return true;
    } catch (error) {
      this.logger.error(`Slack Bot ${this.$id} 取消置顶失败:`, error);
      throw error;
    }
  }
}
