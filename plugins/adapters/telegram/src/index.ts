import { Telegraf, Context as TelegrafContext } from "telegraf";
import type { Message as TelegramMessage, Update, MessageEntity } from "telegraf/types";
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
} from "zhin.js";

// 类型扩展 - 使用 zhin.js 模式
declare module "zhin.js" {
  interface Adapters {
    telegram: TelegramAdapter;
  }
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

        const sendOptions: any = {};

        // Handle reply
        if (quote) {
          const replyToMessageId = typeof quote === "boolean" ? result.$id : quote;
          sendOptions.reply_parameters = { message_id: parseInt(replyToMessageId) };
        }

        const sentMsg = await this.sendContentToChat(
          parseInt(channelId),
          content,
          sendOptions
        );
        return sentMsg.message_id.toString();
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
}

class TelegramAdapter extends Adapter<TelegramBot> {
  constructor(plugin: Plugin) {
    super(plugin, "telegram", []);
  }

  createBot(config: TelegramBotConfig): TelegramBot {
    return new TelegramBot(this, config);
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
