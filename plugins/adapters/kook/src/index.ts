import { Client, PrivateMessageEvent, MessageSegment as MessageElem, ChannelMessageEvent, Sendable } from "kook-client";
import path from "path";
import {
  Bot,
  Adapter,
  Plugin,
  Message,
  SendOptions,
  MessageSegment,
  SendContent,
  segment,
  usePlugin,
} from "zhin.js";

// 定义配置接口 (不使用 Bot.Config，直接定义完整接口)
export interface KookBotConfig extends Client.Config {
  context: "kook";
  name: string;
}

// 类型扩展 - 使用 zhin.js 模式
declare module "zhin.js" {
  namespace Plugin {
    interface Contexts {
      kook: KookAdapter;
    }
  }

  interface RegisteredAdapters {
    kook: KookAdapter;
  }
}

const plugin = usePlugin();
const { provide, useContext } = plugin;

export interface KookBot {
  $config: KookBotConfig;
}

export class KookBot extends Client implements Bot<KookBotConfig, PrivateMessageEvent | ChannelMessageEvent> {
  $connected: boolean= false;

  get $id() {
    return this.$config.name;
  }

  constructor(public adapter: KookAdapter, config: KookBotConfig) {
    if (!config.data_dir) config.data_dir = path.join(process.cwd(), "data");
    super(config);
    this.$config = config;
  }

  $formatMessage(msg: PrivateMessageEvent | ChannelMessageEvent) {
    const message = Message.from(msg, {
      $id: msg.message_id.toString(),
      $adapter: "kook" as const,
      $bot: `${this.$config.name}`,
      $sender: {
        id: msg.author_id.toString(),
        name: msg.author.info.nickname.toString(),
      },
      $channel: {
        id: msg.message_type === "channel" ? msg.channel_id.toString() : msg.author_id.toString(),
        type: msg.message_type,
      },
      $content: KookBot.toSegments(msg.message),
      $raw: msg.raw_message,
      $timestamp: msg.timestamp,
      $recall: async () => {
        await this.$recallMessage(message.$id);
      },
      $reply: async (content: SendContent, quote?: boolean | string): Promise<string> => {
        if (!Array.isArray(content)) content = [content];
        if (quote) content.unshift({ type: "reply", data: { id: typeof quote === "boolean" ? message.$id : quote } });
        return await this.$sendMessage({
          ...message.$channel,
          context: "kook",
          bot: `${this.$config.name}`,
          content,
        });
      },
    });
    return message;
  }

  async $connect(): Promise<void> {
    await super.connect();
    this.on("message", (m) => this.handleKookMessage(m));
    this.$connected = true;
  }

  async $disconnect(): Promise<void> {
    await super.disconnect();
    this.$connected = false;
  }

  async $sendMessage(options: SendOptions): Promise<string> {
    switch (options.type) {
      case "private": {
        const result = await this.sendPrivateMsg(options.id, KookBot.toSendable(options.content));
        plugin.logger.debug(`${this.$config.name} send ${options.type}(${options.id}):${segment.raw(options.content)}`);
        return `private-${options.id}:${(result as unknown as { msg_id: string }).msg_id.toString()}`;
      }
      case "channel": {
        const result = await this.sendChannelMsg(options.id, KookBot.toSendable(options.content));
        plugin.logger.debug(`${this.$config.name} send ${options.type}(${options.id}):${segment.raw(options.content)}`);
        return `channel-${options.id}:${(result as unknown as { msg_id: string }).msg_id.toString()}`;
      }
      default:
        throw new Error(`unsupported channel type ${options.type}`);
    }
  }

  async $recallMessage(id: string): Promise<void> {
    if (!/^(private|channel)-([^\:]+):(.+)$/.test(id)) throw new Error(`invalid message id ${id}`);
    const match = id.match(/^(private|channel)-([^\:]+):(.+)$/);
    if (!match) return;
    const [, target_type, target_id, message_id] = match;
    if (target_type === "private") await this.recallPrivateMsg(target_id, message_id);
    if (target_type === "channel") await this.recallChannelMsg(target_id, message_id);
  }

  private handleKookMessage(msg: PrivateMessageEvent | ChannelMessageEvent): void {
    const message = this.$formatMessage(msg);
    this.adapter.emit("message.receive", message);
    plugin.logger.debug(`${this.$config.name} recv  ${message.$channel.type}(${message.$channel.id}):${segment.raw(message.$content)}`);
  }
}

export namespace KookBot {
  export function toSegments(message: Sendable): MessageSegment[] {
    if (!Array.isArray(message)) message = [message];
    return message.map((item): MessageSegment => {
      if (typeof item === "string") return { type: "text", data: { text: item } };
      const { type, ...data } = item;
      return { type: type === "markdown" ? "text" : type, data };
    });
  }

  export function toSendable(content: SendContent): Sendable {
    if (!Array.isArray(content)) content = [content];
    return content.map((seg): MessageElem => {
      if (typeof seg === "string") return { type: "text", text: seg };
      const { type, data } = seg;
      return { type, ...data } as MessageElem;
    });
  }
}

class KookAdapter extends Adapter<KookBot> {
  constructor(plugin: Plugin) {
    super(plugin, "kook", []);
  }

  createBot(config: KookBotConfig): KookBot {
    return new KookBot(this, config);
  }
}

// 使用新的 provide() API 注册适配器
provide({
  name: "kook",
  description: "Kook Adapter",
  mounted: async (p) => {
    const adapter = new KookAdapter(p);
    await adapter.start();
    return adapter;
  },
  dispose: async (adapter) => {
    await adapter.stop();
  },
});