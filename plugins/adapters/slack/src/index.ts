import { App as SlackApp, LogLevel } from "@slack/bolt";
import { WebClient } from "@slack/web-api";
import type {
  MessageEvent,
  GenericMessageEvent,
  FileShareMessageEvent,
} from "@slack/bolt";
import {
  Bot,
  Adapter,
  Plugin,
  registerAdapter,
  Message,
  SendOptions,
  SendContent,
  MessageSegment,
  segment,
  usePlugin,
} from "zhin.js";

declare module "@zhin.js/types" {
  interface RegisteredAdapters {
    slack: Adapter<SlackBot>;
  }
}

export type SlackBotConfig = Bot.Config & {
  context: "slack";
  token: string; // Bot User OAuth Token
  name: string;
  // Slack specific configuration
  signingSecret: string; // Signing secret for verifying requests
  appToken?: string; // App-level token (for Socket Mode)
  socketMode?: boolean; // Use Socket Mode instead of HTTP
  port?: number; // Port for HTTP mode (default 3000)
  // Optional settings
  logLevel?: LogLevel;
};

export interface SlackBot {
  $config: SlackBotConfig;
}

const plugin = usePlugin();

export class SlackBot implements Bot<GenericMessageEvent, SlackBotConfig> {
  $connected?: boolean;
  private app: SlackApp;
  private client: WebClient;

  constructor(public $config: SlackBotConfig) {
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
        await this.handleSlackMessage(message as GenericMessageEvent);
      });

      // Set up app mention handler
      this.app.event("app_mention", async ({ event, say }) => {
        await this.handleSlackMessage(event as any);
      });

      // Start the app
      const port = this.$config.port || 3000;
      await this.app.start(this.$config.socketMode ? undefined : port);

      this.$connected = true;

      // Get bot info
      const authTest = await this.client.auth.test();
      plugin.logger.info(
        `Slack bot ${this.$config.name} connected successfully as @${authTest.user}`
      );

      if (!this.$config.socketMode) {
        plugin.logger.info(`Slack bot listening on port ${port}`);
      }
    } catch (error) {
      plugin.logger.error("Failed to connect Slack bot:", error);
      this.$connected = false;
      throw error;
    }
  }

  async $disconnect(): Promise<void> {
    try {
      await this.app.stop();
      this.$connected = false;
      plugin.logger.info(`Slack bot ${this.$config.name} disconnected`);
    } catch (error) {
      plugin.logger.error("Error disconnecting Slack bot:", error);
      throw error;
    }
  }

  private async handleSlackMessage(msg: GenericMessageEvent): Promise<void> {
    // Ignore bot messages and message changes
    if (msg.subtype === "bot_message" || msg.subtype === "message_changed") {
      return;
    }

    const message = this.$formatMessage(msg);
    plugin.dispatch("message.receive", message);
    plugin.logger.info(
      `${this.$config.name} recv  ${message.$channel.type}(${message.$channel.id}): ${segment.raw(message.$content)}`
    );
    plugin.dispatch(`message.${message.$channel.type}.receive`, message);
  }

  $formatMessage(msg: GenericMessageEvent): Message<GenericMessageEvent> {
    // Determine channel type based on channel ID
    const channelType = msg.channel_type === "im" ? "private" : "group";
    const channelId = msg.channel;

    // Parse message content
    const content = this.parseMessageContent(msg);

    const result = Message.from(msg, {
      $id: msg.ts,
      $adapter: "slack",
      $bot: this.$config.name,
      $sender: {
        id: msg.user || "",
        name: msg.username || msg.user || "Unknown",
      },
      $channel: {
        id: channelId,
        type: channelType,
      },
      $content: content,
      $raw: msg.text || "",
      $timestamp: parseFloat(msg.ts) * 1000,
      $recall: async () => {
        await this.$recallMessage(result.$id);
      },
      $reply: async (
        content: SendContent,
        quote?: boolean | string
      ): Promise<string> => {
        if (!Array.isArray(content)) content = [content];

        const sendOptions: any = {
          channel: channelId,
        };

        // Handle thread reply
        if (quote) {
          const threadTs = typeof quote === "boolean" ? result.$id : quote;
          sendOptions.thread_ts = threadTs;
        }

        const sentMsg = await this.sendContentToChannel(
          channelId,
          content,
          sendOptions
        );
        return sentMsg.ts || "";
      },
    });

    return result;
  }

  private parseMessageContent(msg: GenericMessageEvent): MessageSegment[] {
    const segments: MessageSegment[] = [];

    // Handle text
    if (msg.text) {
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
    if (msg.attachments) {
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
    options = await plugin.app.handleBeforeSend(options);

    try {
      const result = await this.sendContentToChannel(
        options.id,
        options.content
      );
      plugin.logger.info(
        `${this.$config.name} send ${options.type}(${options.id}): ${segment.raw(options.content)}`
      );
      return result.ts || "";
    } catch (error) {
      plugin.logger.error("Failed to send Slack message:", error);
      throw error;
    }
  }

  private async sendContentToChannel(
    channel: string,
    content: SendContent,
    extraOptions: any = {}
  ): Promise<any> {
    if (!Array.isArray(content)) content = [content];

    let textContent = "";
    const blocks: any[] = [];
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
              plugin.logger.error("Failed to upload file:", error);
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

    if (blocks.length > 0) {
      messageOptions.blocks = blocks;
    }

    const result = await this.client.chat.postMessage(messageOptions);
    return result.message || {};
  }

  async $recallMessage(id: string): Promise<void> {
    try {
      // Slack doesn't support message recall in the traditional sense
      // We can delete messages, but we need the channel
      // This is a limitation - we'd need to store message metadata
      plugin.logger.warn(
        "Message recall not fully supported in Slack adapter - requires channel information"
      );
    } catch (error) {
      plugin.logger.error("Error recalling Slack message:", error);
    }
  }
}

// Register the adapter
registerAdapter(
  new Adapter("slack", (config: any) => new SlackBot(config as SlackBotConfig))
);
