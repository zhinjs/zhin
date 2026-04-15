/**
 * Discord Interactions Bot 实现
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
} from "discord.js";
import nacl from "tweetnacl";
import { Bot, Message, SendOptions, SendContent, MessageSegment, segment } from "zhin.js";
import type { Context } from "koa";
import type { DiscordInteractionsConfig } from "./types.js";
import type { DiscordAdapter } from "./adapter.js";

export class DiscordInteractionsBot
  extends Client
  implements Bot<DiscordInteractionsConfig, any> {
  $connected: boolean;
  private router: import("@zhin.js/http").Router;
  private slashCommandHandlers: Map<
    string,
    (interaction: any) => Promise<void>
  > = new Map();

  get pluginLogger() {
    return this.adapter.plugin.logger;
  }

  get $id() {
    return this.$config.name;
  }

  constructor(public adapter: DiscordAdapter, router: import("@zhin.js/http").Router, public $config: DiscordInteractionsConfig) {
    const intents = $config.intents || [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ];

    super({ intents });
    this.$connected = false;
    this.router = router;

    // 设置交互端点路由
    this.setupInteractionsEndpoint();
  }

  private setupInteractionsEndpoint(): void {
    // 设置路由处理 Discord Interactions
    this.router.post(this.$config.interactionsPath, (ctx: Context) => {
      this.handleInteraction(ctx);
    });
  }

  private async handleInteraction(ctx: Context): Promise<void> {
    try {
      const signature = ctx.get("x-signature-ed25519");
      const timestamp = ctx.get("x-signature-timestamp");
      const bodyString = JSON.stringify((ctx.request as any).body);

      // 验证请求签名
      if (!this.verifyDiscordSignature(bodyString, signature, timestamp)) {
        this.pluginLogger.warn("Invalid Discord signature");
        ctx.status = 401;
        ctx.body = "Unauthorized";
        return;
      }

      const interaction = (ctx.request as any).body;

      // 处理不同类型的交互
      if (interaction.type === InteractionType.Ping) {
        // PING - Discord 验证端点
        ctx.body = { type: InteractionResponseType.Pong };
      } else if (interaction.type === InteractionType.ApplicationCommand) {
        // APPLICATION_COMMAND - 应用命令
        const response = await this.handleApplicationCommand(interaction);
        ctx.body = response;
      } else {
        // 其他交互类型
        ctx.status = 400;
        ctx.body = "Unsupported interaction type";
      }
    } catch (error) {
      this.pluginLogger.error("Interactions error:", error);
      ctx.status = 500;
      ctx.body = "Internal Server Error";
    }
  }

  private verifyDiscordSignature(
    body: string,
    signature: string,
    timestamp: string
  ): boolean {
    try {
      const publicKey = Buffer.from(this.$config.publicKey, "hex");
      const sig = Buffer.from(signature, "hex");
      const message = Buffer.from(timestamp + body, "utf8");

      return nacl.sign.detached.verify(message, sig, publicKey);
    } catch (error) {
      this.pluginLogger.error("Signature verification error:", error);
      return false;
    }
  }

  private async handleApplicationCommand(interaction: any): Promise<any> {
    // 处理应用命令
    const commandName = interaction.data.name;

    // 转换为标准消息格式并分发
    const message = this.formatInteractionAsMessage(interaction);
    this.adapter.emit("message.receive", message);

    // 查找自定义处理器
    const handler = this.slashCommandHandlers.get(commandName);
    if (handler) {
      try {
        await handler(interaction);
      } catch (error) {
        this.pluginLogger.error(
          `Error in slash command handler for ${commandName}:`,
          error
        );
      }
    }

    // 默认响应
    return {
      type: InteractionResponseType.ChannelMessageWithSource,
      data: {
        content: `处理命令: ${commandName}`,
        flags: 64, // EPHEMERAL - 只有用户可见
      },
    };
  }

  private formatInteractionAsMessage(interaction: any): Message<any> {
    const channelType = interaction.guild_id ? "channel" : "private";
    const channelId = interaction.channel_id;

    // 解析命令参数为内容
    const options = interaction.data.options || [];
    const content = [segment.text(`/${interaction.data.name}`)];

    for (const option of options) {
      content.push(segment.text(` ${option.name}:${option.value}`));
    }

    return Message.from(interaction, {
      $id: interaction.id,
      $adapter: "discord",
      $bot: this.$config.name,
      $sender: {
        id: interaction.user?.id || interaction.member?.user?.id,
        name: interaction.user?.username || interaction.member?.user?.username,
      },
      $channel: {
        id: channelId,
        type: channelType as any,
      },
      $raw: JSON.stringify(interaction),
      $timestamp: Date.now(),
      $content: content,
      $recall: async () => {
        // Interactions 消息无法撤回
      },
      $reply: async (content: SendContent): Promise<string> => {
        return this.$sendMessage({
          ...this.$formatMessage(interaction),
          content: content,
        });
      },
    });
  }

  private formatSendContent(content: SendContent): any {
    if (typeof content === "string") {
      return { content };
    }

    if (Array.isArray(content)) {
      const textParts: string[] = [];
      let embed: any = null;

      for (const item of content) {
        if (typeof item === "string") {
          textParts.push(item);
        } else {
          const segment = item as MessageSegment;
          switch (segment.type) {
            case "text":
              textParts.push(segment.data.text || segment.data.content || "");
              break;
            case "embed":
              embed = segment.data;
              break;
          }
        }
      }

      const result: any = {};
      if (textParts.length > 0) {
        result.content = textParts.join("");
      }
      if (embed) {
        result.embeds = [embed];
      }

      return result;
    }

    return { content: String(content) };
  }

  async $connect(): Promise<void> {
    try {
      // 注册 Slash Commands
      if (this.$config.slashCommands) {
        await this.registerSlashCommands();
      }

      // 如果启用 Gateway，连接 Discord Gateway
      if (this.$config.useGateway) {
        await this.login(this.$config.token);

        // 设置活动状态
        if (this.$config.defaultActivity) {
          this.user?.setActivity(this.$config.defaultActivity.name, {
            type: this.getActivityType(this.$config.defaultActivity.type),
            url: this.$config.defaultActivity.url,
          });
        }
      }

      this.$connected = true;
      this.pluginLogger.info(
        `Discord interactions bot connected: ${this.$config.name}`
      );
      this.pluginLogger.info(
        `Interactions endpoint: ${this.$config.interactionsPath}`
      );
    } catch (error) {
      this.pluginLogger.error("Failed to connect Discord interactions bot:", error);
      throw error;
    }
  }

  async $disconnect(): Promise<void> {
    try {
      if (this.isReady()) {
        await this.destroy();
      }
      this.$connected = false;
      this.pluginLogger.info("Discord interactions bot disconnected");
    } catch (error) {
      this.pluginLogger.error(
        "Error disconnecting Discord interactions bot:",
        error
      );
    }
  }

  // Slash Commands 管理
  private async registerSlashCommands(): Promise<void> {
    if (!this.$config.slashCommands) return;

    try {
      const rest = new REST({ version: "10" }).setToken(this.$config.token);

      if (this.$config.globalCommands) {
        await rest.put(Routes.applicationCommands(this.$config.applicationId), {
          body: this.$config.slashCommands,
        });
        this.pluginLogger.info("Successfully registered global slash commands");
      } else {
        this.pluginLogger.info(
          "Note: Guild commands registration requires connecting to Gateway first"
        );
      }
    } catch (error) {
      this.pluginLogger.error("Failed to register slash commands:", error);
    }
  }

  // 添加 Slash Command 处理器
  addSlashCommandHandler(
    commandName: string,
    handler: (interaction: any) => Promise<void>
  ): void {
    this.slashCommandHandlers.set(commandName, handler);
  }

  // 移除 Slash Command 处理器
  removeSlashCommandHandler(commandName: string): boolean {
    return this.slashCommandHandlers.delete(commandName);
  }

  // 工具方法
  private getActivityType(type: string): any {
    const activityTypes: any = {
      PLAYING: 0,
      STREAMING: 1,
      LISTENING: 2,
      WATCHING: 3,
      COMPETING: 5,
    };
    return activityTypes[type] || 0;
  }

  // 简化实现 - 只支持基本消息格式化和发送
  $formatMessage(msg: any): Message<any> {
    return this.formatInteractionAsMessage(msg);
  }

  async $sendMessage(options: SendOptions): Promise<string> {
    // 简化实现 - 通过 REST API 发送消息
    try {
      const rest = new REST({ version: "10" }).setToken(this.$config.token);
      const messageContent = this.formatSendContent(options.content);

      await rest.post(Routes.channelMessages(options.id), {
        body: messageContent,
      });
    } catch (error) {
      this.pluginLogger.error("Failed to send message:", error);
    }
    return "";
  }
  async $recallMessage(id: string): Promise<void> { }
}

// 定义 Adapter 类
