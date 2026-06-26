/**
 * Telegram Endpoint 实现
 */
import { Telegraf, type Context as TelegrafContext } from "telegraf";
import type { Message as TelegramMessage, Update, MessageEntity, ChatMember } from "telegraf/types";
import {
  Endpoint,
  Message,
  SendOptions,
  SendContent,
  MessageSegment,
  segment,
  type QuotedMessagePayload,} from 'zhin.js';
import type { TelegramEndpointConfig, TelegramSenderInfo } from "./types.js";
import type { TelegramAdapter } from "./adapter.js";
import { normalizeTelegramChatMember } from "./platform-permit.js";

export class TelegramEndpoint extends Telegraf implements Endpoint<TelegramEndpointConfig, TelegramMessage> {
  $connected: boolean = false;
  /** message_id -> chat_id，用于在仅有 message_id 的场景执行 reaction 操作 */
  private readonly messageChatMap = new Map<string, string>();
  /** reply_to_message 解析结果缓存，供 $getMsg 使用 */
  private readonly quotedPayloadCache = new Map<string, QuotedMessagePayload>();

  get pluginLogger() {
    return this.adapter.plugin.logger;
  }

  get $id() {
    return this.$config.name;
  }

  constructor(public adapter: TelegramAdapter, public $config: TelegramEndpointConfig) {
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
        if (ctx.callbackQuery && "data" in ctx.callbackQuery) {
          try {
            await ctx.answerCbQuery();
          } catch {
            // already answered
          }
          const message = this.$formatCallbackQuery(ctx);
          this.adapter.emit("message.receive", message);
          this.pluginLogger.debug(
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
      this.pluginLogger.info(
        `Telegram endpoint ${this.$config.name} connected successfully as @${me.username}`
      );
    } catch (error) {
      this.pluginLogger.error("Failed to connect Telegram bot:", error);
      this.$connected = false;
      throw error;
    }
  }

  async $disconnect(): Promise<void> {
    try {
      (this as unknown as import('node:events').EventEmitter).removeAllListeners();
      this.chatMemberCache.clear();
      await this.stop();
      this.$connected = false;
      this.pluginLogger.info(`Telegram endpoint ${this.$config.name} disconnected`);
    } catch (error) {
      this.pluginLogger.error("Error disconnecting Telegram bot:", error);
      throw error;
    }
  }

  private static readonly CHAT_MEMBER_CACHE_TTL_MS = 60_000;
  private static readonly CHAT_MEMBER_CACHE_MAX = 2_000;
  private chatMemberCache = new Map<string, { at: number; role?: string; permissions: string[] }>();

  private sweepChatMemberCache(now: number): void {
    const ttl = TelegramEndpoint.CHAT_MEMBER_CACHE_TTL_MS;
    for (const [key, entry] of this.chatMemberCache) {
      if (now - entry.at >= ttl) this.chatMemberCache.delete(key);
    }
    if (this.chatMemberCache.size > TelegramEndpoint.CHAT_MEMBER_CACHE_MAX) {
      const excess = this.chatMemberCache.size - TelegramEndpoint.CHAT_MEMBER_CACHE_MAX;
      let removed = 0;
      for (const [key] of this.chatMemberCache) {
        if (removed >= excess) break;
        this.chatMemberCache.delete(key);
        removed++;
      }
    }
  }

  private async enrichGroupSender(
    message: Message<TelegramMessage>,
    msg: TelegramMessage,
  ): Promise<void> {
    if (message.$channel.type !== "group" || !msg.from?.id) return;
    const chatId = Number(msg.chat.id);
    const userId = msg.from.id;
    const key = `${chatId}:${userId}`;
    const now = Date.now();
    this.sweepChatMemberCache(now);
    const cached = this.chatMemberCache.get(key);
    if (cached && now - cached.at < TelegramEndpoint.CHAT_MEMBER_CACHE_TTL_MS) {
      message.$sender.role = cached.role;
      message.$sender.permissions = cached.permissions;
      return;
    }
    try {
      const member = await this.getChatMember(chatId, userId);
      const normalized = normalizeTelegramChatMember(member as {
        status?: string;
        can_restrict_members?: boolean;
        can_pin_messages?: boolean;
        can_delete_messages?: boolean;
        can_manage_chat?: boolean;
      });
      this.chatMemberCache.set(key, { at: now, ...normalized });
      message.$sender.role = normalized.role;
      message.$sender.permissions = normalized.permissions;
    } catch {
      // 保守拒绝：无角色快照
    }
  }

  private async handleTelegramMessage(ctx: TelegrafContext): Promise<void> {
    if (!ctx.message) return;

    const message = this.$formatMessage(ctx.message as TelegramMessage);
    await this.enrichGroupSender(message, ctx.message as TelegramMessage);
    this.adapter.emit("message.receive", message);
    this.pluginLogger.debug(
      `${this.$config.name} recv  ${message.$channel.type}(${message.$channel.id}): ${segment.raw(message.$content)}`
    );
  }

  $formatMessage(msg: TelegramMessage): Message<TelegramMessage> {
    // Determine channel type
    const channelType = msg.chat.type === "private" ? "private" : "group";
    const channelId = msg.chat.id.toString();

    // Parse message content
    const content = this.parseMessageContent(msg);
    const quoteId = Message.quoteIdFromContent(content);
    Message.alignReplySegments(content, quoteId);

    const result = Message.from(msg, {
      $id: msg.message_id.toString(),
      $adapter: "telegram",
      $endpoint: this.$config.name,
      $sender: {
        id: msg.from?.id.toString() || "",
        name: msg.from?.username || msg.from?.first_name || "Unknown",
      },
      $channel: {
        id: channelId,
        type: channelType,
      },
      $content: content,
      $quote_id: quoteId,
      $raw: "text" in msg ? msg.text || "" : "",
      $timestamp: msg.date * 1000,
      $recall: async () => {
        try {
          await this.telegram.deleteMessage(parseInt(channelId), parseInt(result.$id));
        } catch (error) {
          this.pluginLogger.error("Error recalling Telegram message:", error);
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
          endpoint: this.$config.name,
          id: channelId,
          type: channelType,
          content: content,
        });
      },
    });

    this.messageChatMap.set(result.$id, channelId);

    return result;
  }

  async $getMsg(messageId: string): Promise<QuotedMessagePayload> {
    const hit = this.quotedPayloadCache.get(messageId);
    if (!hit) {
      throw new Error(`Telegram quoted message ${messageId} is not cached`);
    }
    return hit;
  }

  private cacheQuotedTelegramMessage(msg: TelegramMessage): void {
    const segments = this.parseMessageContent(msg);
    const payload: QuotedMessagePayload = {
      messageId: msg.message_id.toString(),
      sender: msg.from
        ? {
            id: msg.from.id.toString(),
            name: msg.from.username || msg.from.first_name,
          }
        : undefined,
      content: segments,
      raw: "text" in msg ? msg.text : undefined,
      time: msg.date,
    };
    this.quotedPayloadCache.set(payload.messageId, payload);
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
      $endpoint: this.$config.name,
      $sender: {
        id: query.from.id.toString(),
        name: query.from.username || query.from.first_name,
      },
      $channel: {
        id: channelId,
        type: channelType,
      },
      $content: [{
        type: "action",
        data: {
          id: query.id,
          payload: query.data,
          sourceMessageId: msg && "message_id" in msg ? String(msg.message_id) : undefined,
        },
      }],
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
        this.cacheQuotedTelegramMessage(msg.reply_to_message);
        const replyId = msg.reply_to_message.message_id.toString();
        segments.push({
          type: "reply",
          data: { id: replyId, message_id: replyId },
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
      this.messageChatMap.set(result.message_id.toString(), options.id);
      this.pluginLogger.debug(
        `${this.$config.name} send ${options.type}(${options.id}): ${segment.raw(options.content)}`
      );
      return result.message_id.toString();
    } catch (error) {
      this.pluginLogger.error("Failed to send Telegram message:", error);
      throw error;
    }
  }

  async $editMessage(options: import('zhin.js').EditMessageOptions): Promise<void> {
    const chatId = parseInt(options.id);
    const messageId = parseInt(options.messageId);
    const content = Array.isArray(options.content) ? options.content : [options.content];
    let textContent = "";
    let keyboard: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } | undefined;
    for (const seg of content) {
      if (typeof seg === "string") {
        textContent += seg;
        continue;
      }
      if (seg.type === "text") textContent += seg.data.text || "";
      if (seg.type === "keyboard") {
        keyboard = {
          inline_keyboard: (seg.data.rows ?? []).map((row: Array<{ label: string; payload: string; disabled?: boolean }>) =>
            row.map((btn) => ({
              text: btn.label,
              callback_data: String(btn.payload).slice(0, 64),
            })),
          ),
        };
      }
    }
    await this.telegram.editMessageText(
      chatId,
      messageId,
      undefined,
      textContent.trim() || " ",
      keyboard ? { reply_markup: keyboard } : {},
    );
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

        case "keyboard": {
          const rows = (data.rows ?? []).map((row: Array<{ label: string; payload: string; disabled?: boolean }>) =>
            row.map((btn) => ({
              text: btn.label,
              callback_data: String(btn.payload).slice(0, 64),
            })),
          );
          return await this.telegram.sendMessage(chatId, textContent.trim() || " ", {
            reply_markup: { inline_keyboard: rows },
            ...extraOptions,
          });
        }

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
    throw new Error("TelegramEndpoint.$sendMessage: No media or text content to send.");
  }

  async $recallMessage(id: string): Promise<void> {
    // The Endpoint interface only provides message_id, making recall impossible
    // Users should use message.$recall() instead, which has the full context
    throw new Error(
      "TelegramEndpoint.$recallMessage: Message recall not supported without chat_id. " +
      "Use message.$recall() method instead, which contains the required context."
    );
  }

  private resolveTelegramMessageRef(messageId: string): { chatId: number; msgId: number } | null {
    if (messageId.includes(':')) {
      const [chatIdRaw, msgIdRaw] = messageId.split(':');
      const chatId = Number(chatIdRaw);
      const msgId = Number(msgIdRaw);
      if (Number.isFinite(chatId) && Number.isFinite(msgId)) {
        this.messageChatMap.set(String(msgId), String(chatId));
        return { chatId, msgId };
      }
    }

    const mappedChatId = this.messageChatMap.get(messageId);
    if (!mappedChatId) return null;
    const chatId = Number(mappedChatId);
    const msgId = Number(messageId);
    if (!Number.isFinite(chatId) || !Number.isFinite(msgId)) return null;
    return { chatId, msgId };
  }

  async $addReaction(messageId: string, emoji: string): Promise<string | null> {
    const ref = this.resolveTelegramMessageRef(messageId);
    if (!ref) {
      this.pluginLogger.warn(`Telegram Endpoint ${this.$id} 无法根据 message_id=${messageId} 定位 chat_id，跳过 addReaction`);
      return null;
    }

    try {
      await this.setMessageReaction(ref.chatId, ref.msgId, emoji);
      return emoji;
    } catch (error) {
      this.pluginLogger.error(`Telegram Endpoint ${this.$id} 添加 reaction 失败:`, error);
      return null;
    }
  }

  async $removeReaction(messageId: string, _reactionId: string): Promise<void> {
    const ref = this.resolveTelegramMessageRef(messageId);
    if (!ref) {
      this.pluginLogger.warn(`Telegram Endpoint ${this.$id} 无法根据 message_id=${messageId} 定位 chat_id，跳过 removeReaction`);
      return;
    }

    try {
      await (this.telegram as any).callApi('setMessageReaction', {
        chat_id: ref.chatId,
        message_id: ref.msgId,
        reaction: [],
      });
    } catch (error) {
      this.pluginLogger.error(`Telegram Endpoint ${this.$id} 移除 reaction 失败:`, error);
    }
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
      this.pluginLogger.info(`Telegram Endpoint ${this.$id} 踢出用户 ${userId} 从聊天 ${chatId}`);
      return true;
    } catch (error) {
      this.pluginLogger.error(`Telegram Endpoint ${this.$id} 踢出用户失败:`, error);
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
      this.pluginLogger.info(`Telegram Endpoint ${this.$id} 解除用户 ${userId} 的封禁（聊天 ${chatId}）`);
      return true;
    } catch (error) {
      this.pluginLogger.error(`Telegram Endpoint ${this.$id} 解除封禁失败:`, error);
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
      this.pluginLogger.info(`Telegram Endpoint ${this.$id} 限制用户 ${userId} 权限（聊天 ${chatId}）`);
      return true;
    } catch (error) {
      this.pluginLogger.error(`Telegram Endpoint ${this.$id} 限制权限失败:`, error);
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
        this.pluginLogger.info(`Telegram Endpoint ${this.$id} 解除用户 ${userId} 禁言（聊天 ${chatId}）`);
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
        this.pluginLogger.info(`Telegram Endpoint ${this.$id} 禁言用户 ${userId} ${duration}秒（聊天 ${chatId}）`);
      }
      return true;
    } catch (error) {
      this.pluginLogger.error(`Telegram Endpoint ${this.$id} 禁言操作失败:`, error);
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
      this.pluginLogger.info(`Telegram Endpoint ${this.$id} ${promote ? '提升' : '降级'}用户 ${userId} 为管理员（聊天 ${chatId}）`);
      return true;
    } catch (error) {
      this.pluginLogger.error(`Telegram Endpoint ${this.$id} 设置管理员失败:`, error);
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
      this.pluginLogger.info(`Telegram Endpoint ${this.$id} 设置聊天 ${chatId} 标题为 "${title}"`);
      return true;
    } catch (error) {
      this.pluginLogger.error(`Telegram Endpoint ${this.$id} 设置标题失败:`, error);
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
      this.pluginLogger.info(`Telegram Endpoint ${this.$id} 设置聊天 ${chatId} 描述`);
      return true;
    } catch (error) {
      this.pluginLogger.error(`Telegram Endpoint ${this.$id} 设置描述失败:`, error);
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
      this.pluginLogger.info(`Telegram Endpoint ${this.$id} 置顶消息 ${messageId}（聊天 ${chatId}）`);
      return true;
    } catch (error) {
      this.pluginLogger.error(`Telegram Endpoint ${this.$id} 置顶消息失败:`, error);
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
      this.pluginLogger.info(`Telegram Endpoint ${this.$id} 取消置顶消息（聊天 ${chatId}）`);
      return true;
    } catch (error) {
      this.pluginLogger.error(`Telegram Endpoint ${this.$id} 取消置顶失败:`, error);
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
      this.pluginLogger.error(`Telegram Endpoint ${this.$id} 获取聊天信息失败:`, error);
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
      this.pluginLogger.error(`Telegram Endpoint ${this.$id} 获取成员信息失败:`, error);
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
      this.pluginLogger.error(`Telegram Endpoint ${this.$id} 获取管理员列表失败:`, error);
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
      this.pluginLogger.error(`Telegram Endpoint ${this.$id} 获取成员数量失败:`, error);
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
      this.pluginLogger.info(`Telegram Endpoint ${this.$id} 创建邀请链接（聊天 ${chatId}）`);
      return link.invite_link;
    } catch (error) {
      this.pluginLogger.error(`Telegram Endpoint ${this.$id} 创建邀请链接失败:`, error);
      throw error;
    }
  }

  async sendPoll(chatId: number, question: string, options: string[], isAnonymous: boolean = true, allowsMultipleAnswers: boolean = false): Promise<TelegramMessage> {
    try {
      const result = await this.telegram.sendPoll(chatId, question, options, {
        is_anonymous: isAnonymous,
        allows_multiple_answers: allowsMultipleAnswers,
      } as any);
      this.pluginLogger.info(`Telegram Endpoint ${this.$id} 发送投票到 ${chatId}`);
      return result;
    } catch (error) {
      this.pluginLogger.error(`Telegram Endpoint ${this.$id} 发送投票失败:`, error);
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
      this.pluginLogger.error(`Telegram Endpoint ${this.$id} 设置反应失败:`, error);
      throw error;
    }
  }

  async sendStickerMessage(chatId: number, sticker: string): Promise<TelegramMessage> {
    try {
      const result = await this.telegram.sendSticker(chatId, sticker);
      this.pluginLogger.info(`Telegram Endpoint ${this.$id} 发送贴纸到 ${chatId}`);
      return result;
    } catch (error) {
      this.pluginLogger.error(`Telegram Endpoint ${this.$id} 发送贴纸失败:`, error);
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
      this.pluginLogger.info(`Telegram Endpoint ${this.$id} 设置聊天 ${chatId} 权限`);
      return true;
    } catch (error) {
      this.pluginLogger.error(`Telegram Endpoint ${this.$id} 设置聊天权限失败:`, error);
      throw error;
    }
  }
}

