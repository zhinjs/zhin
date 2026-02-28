import { Telegraf, Context as TelegrafContext } from "telegraf";
import type { Message as TelegramMessage, Update, MessageEntity, ChatMember } from "telegraf/types";
import {
  Bot,
  Adapter,
  Plugin,
  Message,
  SendOptions,
  SendContent,
  MessageSegment,
  segment,
  usePlugin,
  Tool,
  ToolPermissionLevel,
} from "zhin.js";

// 类型扩展 - 使用 zhin.js 模式
declare module "zhin.js" {
  interface Adapters {
    telegram: TelegramAdapter;
  }
}

// Telegram 发送者权限信息
export interface TelegramSenderInfo {
  id: string;
  name: string;
  /** 用户名 */
  username?: string;
  /** 是否为群主 */
  isOwner?: boolean;
  /** 是否为管理员 */
  isAdmin?: boolean;
  /** 聊天成员状态 */
  status?: string;
}

// 定义配置接口 (直接定义完整接口)
export interface TelegramBotConfig {
  context: "telegram";
  token: string;
  name: string;
  // Telegram specific configuration
  polling?: boolean; // Use polling instead of webhooks
  webhook?: {
    domain: string;
    path?: string;
    port?: number;
  };
  allowedUpdates?: string[];
}

export interface TelegramBot {
  $config: TelegramBotConfig;
}

const plugin = usePlugin();
const { provide, useContext } = plugin;

export class TelegramBot extends Telegraf implements Bot<TelegramBotConfig, TelegramMessage> {
  $connected: boolean = false;

  get $id() {
    return this.$config.name;
  }

  constructor(public adapter: TelegramAdapter, public $config: TelegramBotConfig) {
    super($config.token);
  }

  async $connect(): Promise<void> {
    try {
      // Set up message handler
      this.on("message", async (ctx) => {
        await this.handleTelegramMessage(ctx);
      });

      // Set up callback query handler (for inline buttons)
      this.on("callback_query", async (ctx) => {
        // Handle callback queries as special messages
        if (ctx.callbackQuery && "data" in ctx.callbackQuery) {
          const message = this.$formatCallbackQuery(ctx);
          this.adapter.emit("message.receive", message);
          plugin.logger.debug(
            `${this.$config.name} recv callback ${message.$channel.type}(${message.$channel.id}): ${segment.raw(message.$content)}`
          );
        }
      });

      // Start bot with polling or webhook
      if (this.$config.polling !== false) {
        // Use polling by default
        await this.launch({
          allowedUpdates: this.$config.allowedUpdates as any,
        });
      } else if (this.$config.webhook) {
        // Use webhook
        const { domain, path = "/telegram-webhook", port } = this.$config.webhook;
        await this.launch({
          webhook: {
            domain,
            port,
            hookPath: path,
          },
          allowedUpdates: this.$config.allowedUpdates as any,
        });
      } else {
        throw new Error("Either polling must be enabled or webhook configuration must be provided");
      }

      this.$connected = true;
      const me = await this.telegram.getMe();
      plugin.logger.info(
        `Telegram bot ${this.$config.name} connected successfully as @${me.username}`
      );
    } catch (error) {
      plugin.logger.error("Failed to connect Telegram bot:", error);
      this.$connected = false;
      throw error;
    }
  }

  async $disconnect(): Promise<void> {
    try {
      await this.stop();
      this.$connected = false;
      plugin.logger.info(`Telegram bot ${this.$config.name} disconnected`);
    } catch (error) {
      plugin.logger.error("Error disconnecting Telegram bot:", error);
      throw error;
    }
  }

  private async handleTelegramMessage(ctx: TelegrafContext): Promise<void> {
    if (!ctx.message) return;

    const message = this.$formatMessage(ctx.message as TelegramMessage);
    this.adapter.emit("message.receive", message);
    plugin.logger.debug(
      `${this.$config.name} recv  ${message.$channel.type}(${message.$channel.id}): ${segment.raw(message.$content)}`
    );
  }

  $formatMessage(msg: TelegramMessage): Message<TelegramMessage> {
    // Determine channel type
    const channelType = msg.chat.type === "private" ? "private" : "group";
    const channelId = msg.chat.id.toString();

    // Parse message content
    const content = this.parseMessageContent(msg);

    const result = Message.from(msg, {
      $id: msg.message_id.toString(),
      $adapter: "telegram",
      $bot: this.$config.name,
      $sender: {
        id: msg.from?.id.toString() || "",
        name: msg.from?.username || msg.from?.first_name || "Unknown",
      },
      $channel: {
        id: channelId,
        type: channelType,
      },
      $content: content,
      $raw: "text" in msg ? msg.text || "" : "",
      $timestamp: msg.date * 1000,
      $recall: async () => {
        try {
          await this.telegram.deleteMessage(parseInt(channelId), parseInt(result.$id));
        } catch (error) {
          plugin.logger.error("Error recalling Telegram message:", error);
          throw error;
        }
      },
      $reply: async (
        content: SendContent,
        quote?: boolean | string
      ): Promise<string> => {
        if (!Array.isArray(content)) content = [content];
        // Handle reply
        if (quote) {
          const replyToMessageId = typeof quote === "boolean" ? result.$id : quote;
          content.unshift({ type: "reply", data: { id: replyToMessageId } });
        }

        return await this.adapter.sendMessage({
          context: "telegram",
          bot: this.$config.name,
          id: channelId,
          type: "private",
          content: content,
        });
      },
    });

    return result;
  }

  private $formatCallbackQuery(ctx: TelegrafContext): Message<any> {
    if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) {
      throw new Error("Invalid callback query");
    }

    const query = ctx.callbackQuery;
    const msg = query.message;
    
    const channelType = msg && "chat" in msg && msg.chat.type === "private" ? "private" : "group";
    const channelId = msg && "chat" in msg ? msg.chat.id.toString() : query.from.id.toString();

    const result = Message.from(query, {
      $id: query.id,
      $adapter: "telegram",
      $bot: this.$config.name,
      $sender: {
        id: query.from.id.toString(),
        name: query.from.username || query.from.first_name,
      },
      $channel: {
        id: channelId,
        type: channelType,
      },
      $content: [{ type: "text", data: { text: query.data } }],
      $raw: query.data,
      $timestamp: Date.now(),
      $recall: async () => {
        // Callback queries cannot be recalled
      },
      $reply: async (content: SendContent): Promise<string> => {
        if (!Array.isArray(content)) content = [content];
        const sentMsg = await this.sendContentToChat(
          parseInt(channelId),
          content
        );
        return sentMsg.message_id.toString();
      },
    });

    return result;
  }

  private parseMessageContent(msg: TelegramMessage): MessageSegment[] {
    const segments: MessageSegment[] = [];

    // Handle text messages
    if ("text" in msg && msg.text) {
      // Check for reply
      if (msg.reply_to_message) {
        segments.push({
          type: "reply",
          data: {
            id: msg.reply_to_message.message_id.toString(),
          },
        });
      }

      // Parse text with entities
      if (msg.entities && msg.entities.length > 0) {
        segments.push(...this.parseTextWithEntities(msg.text, msg.entities));
      } else {
        segments.push({ type: "text", data: { text: msg.text } });
      }
    }

    // Handle photo
    if ("photo" in msg && msg.photo) {
      const largestPhoto = msg.photo[msg.photo.length - 1];
      segments.push({
        type: "image",
        data: {
          file_id: largestPhoto.file_id,
          file_unique_id: largestPhoto.file_unique_id,
          width: largestPhoto.width,
          height: largestPhoto.height,
          file_size: largestPhoto.file_size,
        },
      });
      if (msg.caption) {
        segments.push({ type: "text", data: { text: msg.caption } });
      }
    }

    // Handle video
    if ("video" in msg && msg.video) {
      segments.push({
        type: "video",
        data: {
          file_id: msg.video.file_id,
          file_unique_id: msg.video.file_unique_id,
          width: msg.video.width,
          height: msg.video.height,
          duration: msg.video.duration,
          file_size: msg.video.file_size,
        },
      });
      if (msg.caption) {
        segments.push({ type: "text", data: { text: msg.caption } });
      }
    }

    // Handle audio
    if ("audio" in msg && msg.audio) {
      segments.push({
        type: "audio",
        data: {
          file_id: msg.audio.file_id,
          file_unique_id: msg.audio.file_unique_id,
          duration: msg.audio.duration,
          performer: msg.audio.performer,
          title: msg.audio.title,
          file_size: msg.audio.file_size,
        },
      });
    }

    // Handle voice
    if ("voice" in msg && msg.voice) {
      segments.push({
        type: "voice",
        data: {
          file_id: msg.voice.file_id,
          file_unique_id: msg.voice.file_unique_id,
          duration: msg.voice.duration,
          file_size: msg.voice.file_size,
        },
      });
    }

    // Handle document
    if ("document" in msg && msg.document) {
      segments.push({
        type: "file",
        data: {
          file_id: msg.document.file_id,
          file_unique_id: msg.document.file_unique_id,
          file_name: msg.document.file_name,
          mime_type: msg.document.mime_type,
          file_size: msg.document.file_size,
        },
      });
    }

    // Handle sticker
    if ("sticker" in msg && msg.sticker) {
      segments.push({
        type: "sticker",
        data: {
          file_id: msg.sticker.file_id,
          file_unique_id: msg.sticker.file_unique_id,
          width: msg.sticker.width,
          height: msg.sticker.height,
          is_animated: msg.sticker.is_animated,
          is_video: msg.sticker.is_video,
          emoji: msg.sticker.emoji,
        },
      });
    }

    // Handle location
    if ("location" in msg && msg.location) {
      segments.push({
        type: "location",
        data: {
          longitude: msg.location.longitude,
          latitude: msg.location.latitude,
        },
      });
    }

    return segments.length > 0
      ? segments
      : [{ type: "text", data: { text: "" } }];
  }

  private parseTextWithEntities(
    text: string,
    entities: MessageEntity[]
  ): MessageSegment[] {
    const segments: MessageSegment[] = [];
    let lastOffset = 0;

    for (const entity of entities) {
      // Add text before entity
      if (entity.offset > lastOffset) {
        const beforeText = text.slice(lastOffset, entity.offset);
        if (beforeText) {
          segments.push({ type: "text", data: { text: beforeText } });
        }
      }

      const entityText = text.slice(
        entity.offset,
        entity.offset + entity.length
      );

      switch (entity.type) {
        case "mention":
        case "text_mention":
          segments.push({
            type: "at",
            data: {
              id: ("user" in entity && entity.user?.id.toString()) || entityText.slice(1),
              name: ("user" in entity && entity.user?.username) || entityText,
              text: entityText,
            },
          });
          break;

        case "url":
        case "text_link":
          segments.push({
            type: "link",
            data: {
              url: ("url" in entity && entity.url) || entityText,
              text: entityText,
            },
          });
          break;

        case "hashtag":
          segments.push({
            type: "text",
            data: { text: entityText },
          });
          break;

        case "bold":
        case "italic":
        case "code":
        case "pre":
        case "underline":
        case "strikethrough":
          segments.push({
            type: "text",
            data: { text: entityText, format: entity.type },
          });
          break;

        default:
          segments.push({ type: "text", data: { text: entityText } });
      }

      lastOffset = entity.offset + entity.length;
    }

    // Add remaining text
    if (lastOffset < text.length) {
      const remainingText = text.slice(lastOffset);
      if (remainingText) {
        segments.push({ type: "text", data: { text: remainingText } });
      }
    }

    return segments;
  }

  async $sendMessage(options: SendOptions): Promise<string> {
    try {
      const chatId = parseInt(options.id);
      const result = await this.sendContentToChat(chatId, options.content);
      plugin.logger.debug(
        `${this.$config.name} send ${options.type}(${options.id}): ${segment.raw(options.content)}`
      );
      return result.message_id.toString();
    } catch (error) {
      plugin.logger.error("Failed to send Telegram message:", error);
      throw error;
    }
  }

  private async sendContentToChat(
    chatId: number,
    content: SendContent,
    extraOptions: any = {}
  ): Promise<TelegramMessage> {
    if (!Array.isArray(content)) content = [content];

    let textContent = "";
    let hasMedia = false;

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
          if (data.id) {
            textContent += `@${data.name || data.id}`;
          }
          break;

        case "image":
          hasMedia = true;
          if (data.file_id) {
            // Send by file_id
            return await this.telegram.sendPhoto(chatId, data.file_id, {
              caption: textContent || undefined,
              ...extraOptions,
            });
          } else if (data.url) {
            // Send by URL
            return await this.telegram.sendPhoto(chatId, data.url, {
              caption: textContent || undefined,
              ...extraOptions,
            });
          } else if (data.file) {
            // Send by file path
            return await this.telegram.sendPhoto(
              chatId,
              { source: data.file },
              {
                caption: textContent || undefined,
                ...extraOptions,
              }
            );
          }
          break;

        case "video":
          hasMedia = true;
          if (data.file_id) {
            return await this.telegram.sendVideo(chatId, data.file_id, {
              caption: textContent || undefined,
              ...extraOptions,
            });
          } else if (data.url) {
            return await this.telegram.sendVideo(chatId, data.url, {
              caption: textContent || undefined,
              ...extraOptions,
            });
          } else if (data.file) {
            return await this.telegram.sendVideo(
              chatId,
              { source: data.file },
              {
                caption: textContent || undefined,
                ...extraOptions,
              }
            );
          }
          break;

        case "audio":
          hasMedia = true;
          if (data.file_id) {
            return await this.telegram.sendAudio(chatId, data.file_id, {
              caption: textContent || undefined,
              ...extraOptions,
            });
          } else if (data.url) {
            return await this.telegram.sendAudio(chatId, data.url, {
              caption: textContent || undefined,
              ...extraOptions,
            });
          } else if (data.file) {
            return await this.telegram.sendAudio(
              chatId,
              { source: data.file },
              {
                caption: textContent || undefined,
                ...extraOptions,
              }
            );
          }
          break;

        case "voice":
          hasMedia = true;
          if (data.file_id) {
            return await this.telegram.sendVoice(chatId, data.file_id, {
              caption: textContent || undefined,
              ...extraOptions,
            });
          } else if (data.url) {
            return await this.telegram.sendVoice(chatId, data.url, {
              caption: textContent || undefined,
              ...extraOptions,
            });
          } else if (data.file) {
            return await this.telegram.sendVoice(
              chatId,
              { source: data.file },
              {
                caption: textContent || undefined,
                ...extraOptions,
              }
            );
          }
          break;

        case "file":
          hasMedia = true;
          if (data.file_id) {
            return await this.telegram.sendDocument(chatId, data.file_id, {
              caption: textContent || undefined,
              ...extraOptions,
            });
          } else if (data.url) {
            return await this.telegram.sendDocument(chatId, data.url, {
              caption: textContent || undefined,
              ...extraOptions,
            });
          } else if (data.file) {
            return await this.telegram.sendDocument(
              chatId,
              { source: data.file },
              {
                caption: textContent || undefined,
                ...extraOptions,
              }
            );
          }
          break;

        case "sticker":
          if (data.file_id) {
            hasMedia = true;
            return await this.telegram.sendSticker(chatId, data.file_id, extraOptions);
          }
          break;

        case "location":
          return await this.telegram.sendLocation(
            chatId,
            data.latitude,
            data.longitude,
            extraOptions
          );
          case "reply":
            return await this.telegram.sendMessage(chatId, data.id, {
              reply_parameters: { message_id: parseInt(data.id) },
              ...extraOptions,
            });
        default:
          // Unknown segment type, add as text
          textContent += data.text || `[${type}]`;
      }
    }

    // If no media was sent, send as text message
    if (!hasMedia && textContent.trim()) {
      return await this.telegram.sendMessage(chatId, textContent.trim(), extraOptions);
    }

    // If neither media nor text was sent, this is an error
    throw new Error("TelegramBot.$sendMessage: No media or text content to send.");
  }

  async $recallMessage(id: string): Promise<void> {
    // Telegram requires both chat_id and message_id to delete a message
    // The Bot interface only provides message_id, making recall impossible
    // Users should use message.$recall() instead, which has the full context
    throw new Error(
      "TelegramBot.$recallMessage: Message recall not supported without chat_id. " +
      "Use message.$recall() method instead, which contains the required context."
    );
  }
  // ==================== 群组管理 API ====================

  /**
   * 踢出用户
   * @param chatId 聊天 ID
   * @param userId 用户 ID
   * @param untilDate 封禁截止时间（Unix 时间戳），0 表示永久
   */
  async kickMember(chatId: number, userId: number, untilDate?: number): Promise<boolean> {
    try {
      await this.telegram.banChatMember(chatId, userId, untilDate);
      plugin.logger.info(`Telegram Bot ${this.$id} 踢出用户 ${userId} 从聊天 ${chatId}`);
      return true;
    } catch (error) {
      plugin.logger.error(`Telegram Bot ${this.$id} 踢出用户失败:`, error);
      throw error;
    }
  }

  /**
   * 解除封禁
   * @param chatId 聊天 ID
   * @param userId 用户 ID
   */
  async unbanMember(chatId: number, userId: number): Promise<boolean> {
    try {
      await this.telegram.unbanChatMember(chatId, userId, { only_if_banned: true });
      plugin.logger.info(`Telegram Bot ${this.$id} 解除用户 ${userId} 的封禁（聊天 ${chatId}）`);
      return true;
    } catch (error) {
      plugin.logger.error(`Telegram Bot ${this.$id} 解除封禁失败:`, error);
      throw error;
    }
  }

  /**
   * 限制用户权限（禁言等）
   * @param chatId 聊天 ID
   * @param userId 用户 ID
   * @param permissions 权限设置
   * @param untilDate 限制截止时间
   */
  async restrictMember(chatId: number, userId: number, permissions: {
    can_send_messages?: boolean;
    can_send_media_messages?: boolean;
    can_send_polls?: boolean;
    can_send_other_messages?: boolean;
    can_add_web_page_previews?: boolean;
    can_change_info?: boolean;
    can_invite_users?: boolean;
    can_pin_messages?: boolean;
  }, untilDate?: number): Promise<boolean> {
    try {
      await this.telegram.restrictChatMember(chatId, userId, {
        permissions,
        until_date: untilDate,
      });
      plugin.logger.info(`Telegram Bot ${this.$id} 限制用户 ${userId} 权限（聊天 ${chatId}）`);
      return true;
    } catch (error) {
      plugin.logger.error(`Telegram Bot ${this.$id} 限制权限失败:`, error);
      throw error;
    }
  }

  /**
   * 禁言用户
   * @param chatId 聊天 ID
   * @param userId 用户 ID
   * @param duration 禁言时长（秒），0 表示解除禁言
   */
  async muteMember(chatId: number, userId: number, duration: number = 600): Promise<boolean> {
    try {
      if (duration === 0) {
        // 解除禁言 - 恢复发送消息权限
        await this.telegram.restrictChatMember(chatId, userId, {
          permissions: {
            can_send_messages: true,
            can_send_audios: true,
            can_send_documents: true,
            can_send_photos: true,
            can_send_videos: true,
            can_send_video_notes: true,
            can_send_voice_notes: true,
            can_send_polls: true,
            can_send_other_messages: true,
            can_add_web_page_previews: true,
          },
        });
        plugin.logger.info(`Telegram Bot ${this.$id} 解除用户 ${userId} 禁言（聊天 ${chatId}）`);
      } else {
        const untilDate = Math.floor(Date.now() / 1000) + duration;
        await this.telegram.restrictChatMember(chatId, userId, {
          permissions: {
            can_send_messages: false,
            can_send_audios: false,
            can_send_documents: false,
            can_send_photos: false,
            can_send_videos: false,
            can_send_video_notes: false,
            can_send_voice_notes: false,
            can_send_polls: false,
            can_send_other_messages: false,
            can_add_web_page_previews: false,
          },
          until_date: untilDate,
        });
        plugin.logger.info(`Telegram Bot ${this.$id} 禁言用户 ${userId} ${duration}秒（聊天 ${chatId}）`);
      }
      return true;
    } catch (error) {
      plugin.logger.error(`Telegram Bot ${this.$id} 禁言操作失败:`, error);
      throw error;
    }
  }

  /**
   * 提升/降级管理员
   * @param chatId 聊天 ID
   * @param userId 用户 ID
   * @param promote 是否提升为管理员
   */
  async setAdmin(chatId: number, userId: number, promote: boolean = true): Promise<boolean> {
    try {
      if (promote) {
        await this.telegram.promoteChatMember(chatId, userId, {
          can_manage_chat: true,
          can_delete_messages: true,
          can_manage_video_chats: true,
          can_restrict_members: true,
          can_promote_members: false,
          can_change_info: true,
          can_invite_users: true,
          can_pin_messages: true,
        });
      } else {
        await this.telegram.promoteChatMember(chatId, userId, {
          can_manage_chat: false,
          can_delete_messages: false,
          can_manage_video_chats: false,
          can_restrict_members: false,
          can_promote_members: false,
          can_change_info: false,
          can_invite_users: false,
          can_pin_messages: false,
        });
      }
      plugin.logger.info(`Telegram Bot ${this.$id} ${promote ? '提升' : '降级'}用户 ${userId} 为管理员（聊天 ${chatId}）`);
      return true;
    } catch (error) {
      plugin.logger.error(`Telegram Bot ${this.$id} 设置管理员失败:`, error);
      throw error;
    }
  }

  /**
   * 设置聊天标题
   * @param chatId 聊天 ID
   * @param title 新标题
   */
  async setChatTitle(chatId: number, title: string): Promise<boolean> {
    try {
      await this.telegram.setChatTitle(chatId, title);
      plugin.logger.info(`Telegram Bot ${this.$id} 设置聊天 ${chatId} 标题为 "${title}"`);
      return true;
    } catch (error) {
      plugin.logger.error(`Telegram Bot ${this.$id} 设置标题失败:`, error);
      throw error;
    }
  }

  /**
   * 设置聊天描述
   * @param chatId 聊天 ID
   * @param description 新描述
   */
  async setChatDescription(chatId: number, description: string): Promise<boolean> {
    try {
      await this.telegram.setChatDescription(chatId, description);
      plugin.logger.info(`Telegram Bot ${this.$id} 设置聊天 ${chatId} 描述`);
      return true;
    } catch (error) {
      plugin.logger.error(`Telegram Bot ${this.$id} 设置描述失败:`, error);
      throw error;
    }
  }

  /**
   * 置顶消息
   * @param chatId 聊天 ID
   * @param messageId 消息 ID
   */
  async pinMessage(chatId: number, messageId: number): Promise<boolean> {
    try {
      await this.telegram.pinChatMessage(chatId, messageId);
      plugin.logger.info(`Telegram Bot ${this.$id} 置顶消息 ${messageId}（聊天 ${chatId}）`);
      return true;
    } catch (error) {
      plugin.logger.error(`Telegram Bot ${this.$id} 置顶消息失败:`, error);
      throw error;
    }
  }

  /**
   * 取消置顶消息
   * @param chatId 聊天 ID
   * @param messageId 消息 ID（可选，不提供则取消所有置顶）
   */
  async unpinMessage(chatId: number, messageId?: number): Promise<boolean> {
    try {
      if (messageId) {
        await this.telegram.unpinChatMessage(chatId, messageId);
      } else {
        await this.telegram.unpinAllChatMessages(chatId);
      }
      plugin.logger.info(`Telegram Bot ${this.$id} 取消置顶消息（聊天 ${chatId}）`);
      return true;
    } catch (error) {
      plugin.logger.error(`Telegram Bot ${this.$id} 取消置顶失败:`, error);
      throw error;
    }
  }

  /**
   * 获取聊天信息
   * @param chatId 聊天 ID
   */
  async getChatInfo(chatId: number): Promise<any> {
    try {
      return await this.telegram.getChat(chatId);
    } catch (error) {
      plugin.logger.error(`Telegram Bot ${this.$id} 获取聊天信息失败:`, error);
      throw error;
    }
  }

  /**
   * 获取聊天成员
   * @param chatId 聊天 ID
   * @param userId 用户 ID
   */
  async getChatMember(chatId: number, userId: number): Promise<ChatMember> {
    try {
      return await this.telegram.getChatMember(chatId, userId);
    } catch (error) {
      plugin.logger.error(`Telegram Bot ${this.$id} 获取成员信息失败:`, error);
      throw error;
    }
  }

  /**
   * 获取管理员列表
   * @param chatId 聊天 ID
   */
  async getChatAdmins(chatId: number): Promise<ChatMember[]> {
    try {
      return await this.telegram.getChatAdministrators(chatId);
    } catch (error) {
      plugin.logger.error(`Telegram Bot ${this.$id} 获取管理员列表失败:`, error);
      throw error;
    }
  }

  /**
   * 获取聊天成员数量
   * @param chatId 聊天 ID
   */
  async getChatMemberCount(chatId: number): Promise<number> {
    try {
      return await this.telegram.getChatMembersCount(chatId);
    } catch (error) {
      plugin.logger.error(`Telegram Bot ${this.$id} 获取成员数量失败:`, error);
      throw error;
    }
  }

  /**
   * 创建邀请链接
   * @param chatId 聊天 ID
   */
  async createInviteLink(chatId: number): Promise<string> {
    try {
      const link = await this.telegram.createChatInviteLink(chatId, {});
      plugin.logger.info(`Telegram Bot ${this.$id} 创建邀请链接（聊天 ${chatId}）`);
      return link.invite_link;
    } catch (error) {
      plugin.logger.error(`Telegram Bot ${this.$id} 创建邀请链接失败:`, error);
      throw error;
    }
  }

  async sendPoll(chatId: number, question: string, options: string[], isAnonymous: boolean = true, allowsMultipleAnswers: boolean = false): Promise<TelegramMessage> {
    try {
      const result = await this.telegram.sendPoll(chatId, question, options, {
        is_anonymous: isAnonymous,
        allows_multiple_answers: allowsMultipleAnswers,
      } as any);
      plugin.logger.info(`Telegram Bot ${this.$id} 发送投票到 ${chatId}`);
      return result;
    } catch (error) {
      plugin.logger.error(`Telegram Bot ${this.$id} 发送投票失败:`, error);
      throw error;
    }
  }

  async setMessageReaction(chatId: number, messageId: number, reaction: string): Promise<boolean> {
    try {
      await (this.telegram as any).callApi('setMessageReaction', {
        chat_id: chatId,
        message_id: messageId,
        reaction: [{ type: 'emoji', emoji: reaction }],
      });
      return true;
    } catch (error) {
      plugin.logger.error(`Telegram Bot ${this.$id} 设置反应失败:`, error);
      throw error;
    }
  }

  async sendStickerMessage(chatId: number, sticker: string): Promise<TelegramMessage> {
    try {
      const result = await this.telegram.sendSticker(chatId, sticker);
      plugin.logger.info(`Telegram Bot ${this.$id} 发送贴纸到 ${chatId}`);
      return result;
    } catch (error) {
      plugin.logger.error(`Telegram Bot ${this.$id} 发送贴纸失败:`, error);
      throw error;
    }
  }

  async setChatPermissionsAll(chatId: number, permissions: {
    can_send_messages?: boolean;
    can_send_audios?: boolean;
    can_send_documents?: boolean;
    can_send_photos?: boolean;
    can_send_videos?: boolean;
    can_send_video_notes?: boolean;
    can_send_voice_notes?: boolean;
    can_send_polls?: boolean;
    can_send_other_messages?: boolean;
    can_add_web_page_previews?: boolean;
    can_change_info?: boolean;
    can_invite_users?: boolean;
    can_pin_messages?: boolean;
    can_manage_topics?: boolean;
  }): Promise<boolean> {
    try {
      await this.telegram.setChatPermissions(chatId, permissions);
      plugin.logger.info(`Telegram Bot ${this.$id} 设置聊天 ${chatId} 权限`);
      return true;
    } catch (error) {
      plugin.logger.error(`Telegram Bot ${this.$id} 设置聊天权限失败:`, error);
      throw error;
    }
  }
}

class TelegramAdapter extends Adapter<TelegramBot> {
  constructor(plugin: Plugin) {
    super(plugin, "telegram", []);
  }

  createBot(config: TelegramBotConfig): TelegramBot {
    return new TelegramBot(this, config);
  }

  async start(): Promise<void> {
    this.registerTelegramTools();
    this.declareSkill({
      description: 'Telegram 群组管理能力，包括成员管理（踢人、解封、禁言、设管理员、设头衔）、消息管理（置顶、取消置顶）、群信息查询（管理员列表、成员数、群信息）、邀请链接生成、发起投票、消息表情反应、发送贴纸、群权限控制、设置群描述。',
      keywords: ['Telegram', 'TG', '电报', '群组管理', '投票', 'poll', '反应', 'react', '贴纸', 'sticker', '权限', 'permissions'],
      tags: ['telegram', '群组管理', '社交平台'],
      conventions: 'chat_id 使用数字 ID 标识（群组为负数）。user_id 为数字用户 ID。调用工具时 bot 参数应填当前上下文的 Bot ID，chat_id 应填当前场景 ID。',
    });
    await super.start();
  }

  /**
   * 注册 Telegram 平台特有的群组管理工具
   */
  private registerTelegramTools(): void {
    // 踢出用户工具
    this.addTool({
      name: 'telegram_kick_user',
      description: '将用户踢出 Telegram 群组（需要管理员权限）',
      parameters: {
        type: 'object',
        properties: {
          bot: { type: 'string', description: 'Bot 名称' },
          chat_id: { type: 'number', description: '聊天 ID' },
          user_id: { type: 'number', description: '用户 ID' },
        },
        required: ['bot', 'chat_id', 'user_id'],
      },
      platforms: ['telegram'],
      scopes: ['group'],
      permissionLevel: 'group_admin',
      execute: async (args) => {
        const { bot: botId, chat_id, user_id } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const success = await bot.kickMember(chat_id, user_id);
        return { success, message: success ? `已将用户 ${user_id} 踢出群组` : '操作失败' };
      },
    });

    // 解除封禁工具
    this.addTool({
      name: 'telegram_unban_user',
      description: '解除用户在 Telegram 群组的封禁',
      parameters: {
        type: 'object',
        properties: {
          bot: { type: 'string', description: 'Bot 名称' },
          chat_id: { type: 'number', description: '聊天 ID' },
          user_id: { type: 'number', description: '用户 ID' },
        },
        required: ['bot', 'chat_id', 'user_id'],
      },
      platforms: ['telegram'],
      scopes: ['group'],
      permissionLevel: 'group_admin',
      execute: async (args) => {
        const { bot: botId, chat_id, user_id } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const success = await bot.unbanMember(chat_id, user_id);
        return { success, message: success ? `已解除用户 ${user_id} 的封禁` : '操作失败' };
      },
    });

    // 禁言用户工具
    this.addTool({
      name: 'telegram_mute_user',
      description: '禁言 Telegram 群组成员',
      parameters: {
        type: 'object',
        properties: {
          bot: { type: 'string', description: 'Bot 名称' },
          chat_id: { type: 'number', description: '聊天 ID' },
          user_id: { type: 'number', description: '用户 ID' },
          duration: { type: 'number', description: '禁言时长（秒），0 表示解除禁言，默认 600' },
        },
        required: ['bot', 'chat_id', 'user_id'],
      },
      platforms: ['telegram'],
      scopes: ['group'],
      permissionLevel: 'group_admin',
      execute: async (args) => {
        const { bot: botId, chat_id, user_id, duration = 600 } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const success = await bot.muteMember(chat_id, user_id, duration);
        return { 
          success, 
          message: success 
            ? (duration > 0 ? `已禁言用户 ${user_id} ${duration} 秒` : `已解除用户 ${user_id} 的禁言`)
            : '操作失败' 
        };
      },
    });

    // 设置管理员工具
    this.addTool({
      name: 'telegram_set_admin',
      description: '提升/降级 Telegram 群组管理员（需要群主权限）',
      parameters: {
        type: 'object',
        properties: {
          bot: { type: 'string', description: 'Bot 名称' },
          chat_id: { type: 'number', description: '聊天 ID' },
          user_id: { type: 'number', description: '用户 ID' },
          promote: { type: 'boolean', description: '是否提升为管理员，默认 true' },
        },
        required: ['bot', 'chat_id', 'user_id'],
      },
      platforms: ['telegram'],
      scopes: ['group'],
      permissionLevel: 'group_owner',
      execute: async (args) => {
        const { bot: botId, chat_id, user_id, promote = true } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const success = await bot.setAdmin(chat_id, user_id, promote);
        return { 
          success, 
          message: success 
            ? (promote ? `已将用户 ${user_id} 提升为管理员` : `已降级用户 ${user_id}`)
            : '操作失败' 
        };
      },
    });

    // 设置群标题工具
    this.addTool({
      name: 'telegram_set_title',
      description: '设置 Telegram 群组标题',
      parameters: {
        type: 'object',
        properties: {
          bot: { type: 'string', description: 'Bot 名称' },
          chat_id: { type: 'number', description: '聊天 ID' },
          title: { type: 'string', description: '新标题' },
        },
        required: ['bot', 'chat_id', 'title'],
      },
      platforms: ['telegram'],
      scopes: ['group'],
      permissionLevel: 'group_admin',
      execute: async (args) => {
        const { bot: botId, chat_id, title } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const success = await bot.setChatTitle(chat_id, title);
        return { success, message: success ? `已将群标题设为 "${title}"` : '操作失败' };
      },
    });

    // 置顶消息工具
    this.addTool({
      name: 'telegram_pin_message',
      description: '置顶 Telegram 群组消息',
      parameters: {
        type: 'object',
        properties: {
          bot: { type: 'string', description: 'Bot 名称' },
          chat_id: { type: 'number', description: '聊天 ID' },
          message_id: { type: 'number', description: '消息 ID' },
        },
        required: ['bot', 'chat_id', 'message_id'],
      },
      platforms: ['telegram'],
      scopes: ['group'],
      permissionLevel: 'group_admin',
      execute: async (args) => {
        const { bot: botId, chat_id, message_id } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const success = await bot.pinMessage(chat_id, message_id);
        return { success, message: success ? '消息已置顶' : '操作失败' };
      },
    });

    // 取消置顶工具
    this.addTool({
      name: 'telegram_unpin_message',
      description: '取消置顶 Telegram 群组消息',
      parameters: {
        type: 'object',
        properties: {
          bot: { type: 'string', description: 'Bot 名称' },
          chat_id: { type: 'number', description: '聊天 ID' },
          message_id: { type: 'number', description: '消息 ID（可选，不提供则取消所有置顶）' },
        },
        required: ['bot', 'chat_id'],
      },
      platforms: ['telegram'],
      scopes: ['group'],
      permissionLevel: 'group_admin',
      execute: async (args) => {
        const { bot: botId, chat_id, message_id } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const success = await bot.unpinMessage(chat_id, message_id);
        return { success, message: success ? '已取消置顶' : '操作失败' };
      },
    });

    // 获取管理员列表工具
    this.addTool({
      name: 'telegram_list_admins',
      description: '获取 Telegram 群组管理员列表',
      parameters: {
        type: 'object',
        properties: {
          bot: { type: 'string', description: 'Bot 名称' },
          chat_id: { type: 'number', description: '聊天 ID' },
        },
        required: ['bot', 'chat_id'],
      },
      platforms: ['telegram'],
      scopes: ['group'],
      permissionLevel: 'user',
      execute: async (args) => {
        const { bot: botId, chat_id } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const admins = await bot.getChatAdmins(chat_id);
        return { 
          admins: admins.map(a => ({
            user_id: a.user.id,
            username: a.user.username,
            first_name: a.user.first_name,
            status: a.status,
          })),
          count: admins.length,
        };
      },
    });

    // 获取成员数量工具
    this.addTool({
      name: 'telegram_member_count',
      description: '获取 Telegram 群组成员数量',
      parameters: {
        type: 'object',
        properties: {
          bot: { type: 'string', description: 'Bot 名称' },
          chat_id: { type: 'number', description: '聊天 ID' },
        },
        required: ['bot', 'chat_id'],
      },
      platforms: ['telegram'],
      scopes: ['group'],
      permissionLevel: 'user',
      execute: async (args) => {
        const { bot: botId, chat_id } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const count = await bot.getChatMemberCount(chat_id);
        return { count, message: `群组共有 ${count} 名成员` };
      },
    });

    // 创建邀请链接工具
    this.addTool({
      name: 'telegram_create_invite',
      description: '创建 Telegram 群组邀请链接',
      parameters: {
        type: 'object',
        properties: {
          bot: { type: 'string', description: 'Bot 名称' },
          chat_id: { type: 'number', description: '聊天 ID' },
        },
        required: ['bot', 'chat_id'],
      },
      platforms: ['telegram'],
      scopes: ['group'],
      permissionLevel: 'group_admin',
      execute: async (args) => {
        const { bot: botId, chat_id } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const link = await bot.createInviteLink(chat_id);
        return { invite_link: link, message: `邀请链接: ${link}` };
      },
    });

    // 获取群信息工具
    this.addTool({
      name: 'telegram_chat_info',
      description: '获取 Telegram 聊天/群组信息',
      parameters: {
        type: 'object',
        properties: {
          bot: { type: 'string', description: 'Bot 名称' },
          chat_id: { type: 'number', description: '聊天 ID' },
        },
        required: ['bot', 'chat_id'],
      },
      platforms: ['telegram'],
      scopes: ['group', 'private'],
      permissionLevel: 'user',
      execute: async (args) => {
        const { bot: botId, chat_id } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const info = await bot.getChatInfo(chat_id);
        return {
          id: info.id,
          type: info.type,
          title: info.title,
          username: info.username,
          description: info.description,
          member_count: (info as any).member_count,
        };
      },
    });

    // 发起投票
    this.addTool({
      name: 'telegram_send_poll',
      description: '在 Telegram 群组中发起投票',
      parameters: {
        type: 'object',
        properties: {
          bot: { type: 'string', description: 'Bot 名称' },
          chat_id: { type: 'number', description: '聊天 ID' },
          question: { type: 'string', description: '投票问题' },
          options: { type: 'string', description: '选项，用逗号分隔' },
          is_anonymous: { type: 'boolean', description: '是否匿名投票，默认 true' },
          allows_multiple: { type: 'boolean', description: '是否允许多选，默认 false' },
        },
        required: ['bot', 'chat_id', 'question', 'options'],
      },
      platforms: ['telegram'],
      scopes: ['group'],
      permissionLevel: 'user',
      execute: async (args) => {
        const { bot: botId, chat_id, question, options, is_anonymous = true, allows_multiple = false } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const optList = options.split(',').map((o: string) => o.trim()).filter(Boolean);
        if (optList.length < 2) return { success: false, message: '至少需要 2 个选项' };
        const result = await bot.sendPoll(chat_id, question, optList, is_anonymous, allows_multiple);
        return { success: true, message_id: result.message_id, message: '投票已发送' };
      },
    });

    // 消息表情反应
    this.addTool({
      name: 'telegram_react',
      description: '对 Telegram 消息添加表情反应',
      parameters: {
        type: 'object',
        properties: {
          bot: { type: 'string', description: 'Bot 名称' },
          chat_id: { type: 'number', description: '聊天 ID' },
          message_id: { type: 'number', description: '消息 ID' },
          reaction: { type: 'string', description: '反应表情（如 👍、❤️、🔥）' },
        },
        required: ['bot', 'chat_id', 'message_id', 'reaction'],
      },
      platforms: ['telegram'],
      scopes: ['group', 'private'],
      permissionLevel: 'user',
      execute: async (args) => {
        const { bot: botId, chat_id, message_id, reaction } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const success = await bot.setMessageReaction(chat_id, message_id, reaction);
        return { success, message: success ? `已添加反应 ${reaction}` : '操作失败' };
      },
    });

    // 发送贴纸
    this.addTool({
      name: 'telegram_send_sticker',
      description: '发送 Telegram 贴纸',
      parameters: {
        type: 'object',
        properties: {
          bot: { type: 'string', description: 'Bot 名称' },
          chat_id: { type: 'number', description: '聊天 ID' },
          sticker: { type: 'string', description: '贴纸 file_id 或 URL' },
        },
        required: ['bot', 'chat_id', 'sticker'],
      },
      platforms: ['telegram'],
      scopes: ['group', 'private'],
      permissionLevel: 'user',
      execute: async (args) => {
        const { bot: botId, chat_id, sticker } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const result = await bot.sendStickerMessage(chat_id, sticker);
        return { success: true, message_id: result.message_id, message: '贴纸已发送' };
      },
    });

    // 设置群权限
    this.addTool({
      name: 'telegram_set_permissions',
      description: '设置 Telegram 群组的默认成员权限',
      parameters: {
        type: 'object',
        properties: {
          bot: { type: 'string', description: 'Bot 名称' },
          chat_id: { type: 'number', description: '聊天 ID' },
          can_send_messages: { type: 'boolean', description: '是否可以发消息' },
          can_send_photos: { type: 'boolean', description: '是否可以发图片' },
          can_send_videos: { type: 'boolean', description: '是否可以发视频' },
          can_send_polls: { type: 'boolean', description: '是否可以发投票' },
          can_send_other_messages: { type: 'boolean', description: '是否可以发贴纸/GIF等' },
          can_add_web_page_previews: { type: 'boolean', description: '是否可以添加网页预览' },
          can_change_info: { type: 'boolean', description: '是否可以改群信息' },
          can_invite_users: { type: 'boolean', description: '是否可以邀请用户' },
          can_pin_messages: { type: 'boolean', description: '是否可以置顶消息' },
        },
        required: ['bot', 'chat_id'],
      },
      platforms: ['telegram'],
      scopes: ['group'],
      permissionLevel: 'group_admin',
      execute: async (args) => {
        const { bot: botId, chat_id, ...perms } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const permissions: any = {};
        for (const [k, v] of Object.entries(perms)) {
          if (typeof v === 'boolean') permissions[k] = v;
        }
        const success = await bot.setChatPermissionsAll(chat_id, permissions);
        return { success, message: success ? '群权限已更新' : '操作失败' };
      },
    });

    // 设置群描述
    this.addTool({
      name: 'telegram_set_description',
      description: '设置 Telegram 群组描述',
      parameters: {
        type: 'object',
        properties: {
          bot: { type: 'string', description: 'Bot 名称' },
          chat_id: { type: 'number', description: '聊天 ID' },
          description: { type: 'string', description: '群描述文字' },
        },
        required: ['bot', 'chat_id', 'description'],
      },
      platforms: ['telegram'],
      scopes: ['group'],
      permissionLevel: 'group_admin',
      execute: async (args) => {
        const { bot: botId, chat_id, description } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const success = await bot.setChatDescription(chat_id, description);
        return { success, message: success ? '群描述已更新' : '操作失败' };
      },
    });

    plugin.logger.debug('已注册 Telegram 平台群组管理工具');
  }
}

// 使用新的 provide() API 注册适配器
provide({
  name: "telegram",
  description: "Telegram Bot Adapter",
  mounted: async (p) => {
    const adapter = new TelegramAdapter(p);
    await adapter.start();
    return adapter;
  },
  dispose: async (adapter) => {
    await adapter.stop();
  },
});
