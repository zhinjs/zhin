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
        return await this.$sendMessage({
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
          return `direct-${options.id}:${result.message_id.toString()}`;
        } else {
          const result = await this.sendPrivateMessage(options.id, options.content);
          plugin.logger.debug(`${this.$config.name} send ${options.type}(${options.id}):${segment.raw(options.content)}`);
          return `private-${options.id}:${result.message_id.toString()}`;
        }
      }
      case "group": {
        const result = await this.sendGroupMessage(options.id, options.content);
        plugin.logger.debug(`${this.$config.name} send ${options.type}(${options.id}):${segment.raw(options.content)}`);
        return `group-${options.id}:${result.message_id.toString()}`;
      }
      case "channel": {
        const result = await this.sendGuildMessage(options.id, options.content);
        plugin.logger.debug(`${this.$config.name} send ${options.type}(${options.id}):${segment.raw(options.content)}`);
        return `channel-${options.id}:${result.message_id.toString()}`;
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
}

class QQAdapter extends Adapter<QQBot<ReceiverMode>> {
  constructor(plugin: Plugin) {
    super(plugin, "qq", []);
  }

  createBot(config: QQBotConfig<ReceiverMode>): QQBot<ReceiverMode> {
    return new QQBot(this, config);
  }
}

// 使用新的 provide() API 注册适配器
provide({
  name: "qq",
  description: "QQ Official Bot Adapter",
  mounted: async (p) => {
    const adapter = new QQAdapter(p);
    await adapter.start();
    return adapter;
  },
  dispose: async (adapter) => {
    await adapter.stop();
  },
});
