import { Config, Client, PrivateMessageEvent, GroupMessageEvent, Sendable, MessageElem } from "@icqqjs/icqq";
import path from "path";
import {
  Bot,
  usePlugin,
  Adapter,
  Plugin,
  Message,
  SendOptions,
  MessageSegment,
  SendContent,
  segment,
} from "@zhin.js/core";
import { Router } from "@zhin.js/http";

declare module "@zhin.js/core" {
  namespace Plugin {
    interface Contexts {
      icqq: IcqqAdapter;
      web: any;
      router: Router;
    }
  }
  
  interface RegisteredAdapters {
    icqq: IcqqAdapter;
  }
}

const plugin = usePlugin();
const { useContext } = plugin;

export interface IcqqBotConfig extends Config {
  context: "icqq";
  name: `${number}`;
  password?: string;
  scope?: string;
}

export interface IcqqBot {
  $config: IcqqBotConfig;
}

export class IcqqBot extends Client implements Bot<IcqqBotConfig, PrivateMessageEvent | GroupMessageEvent> {
  $connected?: boolean;

  get $id() {
    return this.$config.name;
  }

  constructor(public adapter: IcqqAdapter, config: IcqqBotConfig) {
    if (!config.scope) config.scope = "icqqjs";
    if (!config.data_dir) config.data_dir = path.join(process.cwd(), "data");
    if (config.scope.startsWith("@")) config.scope = config.scope.slice(1);
    super(config);
    this.$config = config;
  }

  private handleIcqqMessage(msg: PrivateMessageEvent | GroupMessageEvent): void {
    const message = this.$formatMessage(msg);
    this.adapter.emit("message.receive", message);
    plugin.logger.debug(`${this.$config.name} recv  ${message.$channel.type}(${message.$channel.id}):${segment.raw(message.$content)}`);
  }

  async $connect(): Promise<void> {
    this.on("message", this.handleIcqqMessage.bind(this));
    this.on("system.login.device", async (e: unknown) => {
      await this.sendSmsCode();
      plugin.logger.info("请输入短信验证码:");
      process.stdin.once("data", (data) => {
        this.submitSmsCode(data.toString().trim());
      });
    });
    this.on("system.login.qrcode", (e) => {
      plugin.logger.info(`取码地址：${e.image}\n请扫码完成后回车继续:`);
      process.stdin.once("data", () => {
        this.login();
      });
    });
    this.on("system.login.slider", (e) => {
      plugin.logger.info(`取码地址：${e.url}\n请输入滑块验证ticket:`);
      process.stdin.once("data", (e) => {
        this.submitSlider(e.toString().trim());
      });
    });
    return new Promise((resolve) => {
      this.once("system.online", () => {
        this.$connected = true;
        resolve();
      });
      this.login(Number(this.$config.name), this.$config.password);
    });
  }

  async $disconnect(): Promise<void> {
    await this.logout();
    this.$connected = false;
  }

  $formatMessage(msg: PrivateMessageEvent | GroupMessageEvent) {
    const result = Message.from(msg, {
      $id: msg.message_id.toString(),
      $adapter: "icqq" as const,
      $bot: `${this.$config.name}`,
      $sender: {
        id: msg.sender.user_id.toString(),
        name: msg.sender.nickname.toString(),
      },
      $channel: {
        id: msg.message_type === "group" ? msg.group_id.toString() : msg.from_id.toString(),
        type: msg.message_type,
      },
      $content: IcqqBot.toSegments(msg.message),
      $raw: msg.raw_message,
      $timestamp: msg.time,
      $recall: async () => {
        await this.$recallMessage(result.$id);
      },
      $reply: async (content: SendContent, quote?: boolean | string): Promise<string> => {
        if (!Array.isArray(content)) content = [content];
        if (quote) content.unshift({ type: "reply", data: { id: typeof quote === "boolean" ? result.$id : quote } });
        return await this.$sendMessage({
          ...result.$channel,
          context: "icqq",
          bot: `${this.uin}`,
          content,
        });
      },
    });
    return result;
  }

  async $recallMessage(id: string): Promise<void> {
    await this.deleteMsg(id);
  }

  async $sendMessage(options: SendOptions): Promise<string> {
    switch (options.type) {
      case "private": {
        const result = await this.sendPrivateMsg(Number(options.id), IcqqBot.toSendable(options.content));
        plugin.logger.debug(`${this.$config.name} send ${options.type}(${options.id}):${segment.raw(options.content)}`);
        return result.message_id.toString();
      }
      case "group": {
        const result = await this.sendGroupMsg(Number(options.id), IcqqBot.toSendable(options.content));
        plugin.logger.debug(`${this.$config.name} send ${options.type}(${options.id}):${segment.raw(options.content)}`);
        return result.message_id.toString();
      }
      default:
        throw new Error(`unsupported channel type ${options.type}`);
    }
  }
}

export namespace IcqqBot {
  const allowTypes = ["text", "face", "image", "record", "audio", "dice", "rps", "video", "file", "location", "share", "json", "at", "reply", "long_msg", "button", "markdown", "xml"];

  export function toSegments(message: Sendable): MessageSegment[] {
    if (!Array.isArray(message)) message = [message];
    return message
      .filter((item, index) => {
        return typeof item === "string" || item.type !== "long_msg" || index !== 0;
      })
      .map((item): MessageSegment => {
        if (typeof item === "string") return { type: "text", data: { text: item } };
        const { type, ...data } = item;
        return { type, data };
      });
  }

  export function toSendable(content: SendContent): Sendable {
    if (!Array.isArray(content)) content = [content];
    return content.map((seg): MessageElem => {
      if (typeof seg === "string") return { type: "text", text: seg };
      let { type, data } = seg;
      if (typeof type === "function") type = type.name;
      if (!allowTypes.includes(type)) return { type: "text", text: segment.toString(seg) };
      return { type, ...data } as MessageElem;
    });
  }
}

class IcqqAdapter extends Adapter<IcqqBot> {
  constructor(plugin: Plugin) {
    super(plugin, "icqq", []);
  }

  createBot(config: IcqqBotConfig): IcqqBot {
    return new IcqqBot(this, config);
  }
}

const { provide } = usePlugin();

provide({
  name: "icqq",
  description: "ICQQ Adapter",
  mounted: async (p) => {
    const adapter = new IcqqAdapter(p);
    await adapter.start();
    return adapter;
  },
  dispose: async (adapter) => {
    await adapter.stop();
  },
});

useContext("web", (web: any) => {
  // 注册ICQQ适配器的客户端入口文件
  const dispose = web.addEntry({
    production: path.resolve(import.meta.dirname, "../dist/index.js"),
    development: path.resolve(import.meta.dirname, "../client/index.tsx"),
  });
  return dispose;
});

useContext("router", async (router: Router) => {
  const icqq = plugin.root.inject("icqq") as IcqqAdapter;
  router.get("/api/icqq/bots", async (ctx: any) => {
    try {
      const bots = Array.from(icqq.bots.values());

      if (bots.length === 0) {
        ctx.body = {
          success: true,
          data: [],
          message: "暂无ICQQ机器人实例",
        };
        return;
      }

      const result = bots.map((bot) => {
        try {
          return {
            name: bot.$config.name,
            connected: bot.$connected || false,
            groupCount: bot.gl?.size || 0,
            friendCount: bot.fl?.size || 0,
            receiveCount: bot.stat?.recv_msg_cnt || 0,
            sendCount: bot.stat?.sent_msg_cnt || 0,
            loginMode: bot.$config.password ? "password" : "qrcode",
            status: bot.$connected ? "online" : "offline",
            lastActivity: new Date().toISOString(),
          };
        } catch (botError) {
          // 单个机器人数据获取失败时的处理
          return {
            name: bot.$config.name,
            connected: false,
            groupCount: 0,
            friendCount: 0,
            receiveCount: 0,
            sendCount: 0,
            loginMode: "unknown",
            status: "error",
            error: "数据获取失败",
          };
        }
      });

      ctx.body = {
        success: true,
        data: result,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      ctx.status = 500;
      ctx.body = {
        success: false,
        error: "ICQQ_API_ERROR",
        message: "获取机器人数据失败",
        details: process.env.NODE_ENV === "development" ? (error as Error).message : undefined,
        timestamp: new Date().toISOString(),
      };
    }
  });
});
