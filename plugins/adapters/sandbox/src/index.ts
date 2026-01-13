import { EventEmitter } from "events";
import {
  Bot,
  Adapter,
  usePlugin,
  Message,
  SendOptions,
  segment,
  SendContent,
  MessageType,
  MessageElement,
  Plugin,
} from "zhin.js";
import type { WebSocket } from "ws";
import { Router } from "@zhin.js/http";
import path from "path";

export interface SandboxConfig {
  context: "sandbox";
  ws: WebSocket;
  name: string;
}

declare module "zhin.js" {
  namespace Plugin {
    interface Contexts {
      router: Router;
      web: any;
    }
  }

  interface Adapters {
    sandbox: SandboxAdapter;
  }
}

const plugin = usePlugin();
const logger = plugin.logger;

interface WebSocketMessage {
  type: MessageType;
  id: string;
  content: MessageElement[] | string;
  timestamp: number;
}

export class SandboxBot extends EventEmitter implements Bot<SandboxConfig, { content: MessageElement[]; ts: number }> {
  $connected: boolean = false;

  get $id() {
    return this.$config.name;
  }

  private logger = logger;

  constructor(public adapter: SandboxAdapter, public $config: SandboxConfig) {
    super();
    this.$config.ws.on("message", (data) => {
      const message = JSON.parse(data.toString()) as WebSocketMessage;
      // 确保 content 是 MessageElement[] 格式
      const content: MessageElement[] = typeof message.content === 'string' 
        ? [{ type: 'text', data: { text: message.content } }]
        : message.content;
      this.logger.debug(`${this.$config.name} recv  ${message.type}(${message.id}):${segment.raw(content)}`);
      const formattedMessage = this.$formatMessage({ content: content, type: message.type, id: message.id, ts: message.timestamp });
      this.adapter.emit("message.receive", formattedMessage);
    });

    this.$config.ws.on("close", () => {
      this.logger.debug(`Sandbox bot ${this.$config.name} disconnected`);
      this.$connected = false;
      // 从 adapter 中移除 bot
      this.adapter.bots.delete(this.$id);
    });
  }

  async $connect(): Promise<void> {
    this.$connected = true;
  }

  async $disconnect(): Promise<void> {
    this.$config.ws.close();
    this.$connected = false;
  }

  $formatMessage({ content, type, id, ts }: { content: MessageElement[]; id: string; type: MessageType; ts: number }) {
    const message = Message.from(
      { content, ts },
      {
        $id: `${ts}`,
        $adapter: "sandbox" as const,
        $bot: `${this.$config.name}`,
        $sender: {
          id: `${id}`,
          name: `mock`,
        },
        $channel: {
          id: `${id}`,
          type: type,
        },
        $content: content,
        $raw: segment.raw(content),
        $timestamp: ts,
        $recall: async () => {
          await this.$recallMessage(message.$id);
        },
        $reply: async (content: SendContent, quote?: boolean | string): Promise<string> => {
          if (!Array.isArray(content)) content = [content];
          if (quote) content.unshift({ type: "reply", data: { id: typeof quote === "boolean" ? message.$id : quote } });
          return await this.$sendMessage({
            ...message.$channel,
            context: "sandbox",
            bot: `${this.$config.name}`,
            content,
          });
        },
      }
    );
    return message;
  }

  async $sendMessage(options: SendOptions): Promise<string> {
    if (!this.$connected) return "";
    this.logger.debug(`${this.$config.name} send ${options.type}(${options.id}):${segment.raw(options.content)}`);
    options.bot = this.$config.name;
    options.context = "sandbox";
    this.$config.ws.send(
      JSON.stringify({
        ...options,
        content: options.content, // 发送消息段数组
        timestamp: Date.now(),
      })
    );
    return "";
  }

  async $recallMessage(id: string): Promise<void> {
    // 沙盒不支持撤回消息
  }
}

class SandboxAdapter extends Adapter<SandboxBot> {
  wss?: ReturnType<Router["ws"]>;

  constructor(plugin: Plugin) {
    super(plugin, "sandbox", []);
  }

  createBot(config: SandboxConfig): SandboxBot {
    const bot = new SandboxBot(this, config);
    // 将 bot 添加到 bots Map 中
    this.bots.set(bot.$id, bot);
    return bot;
  }

  async start(): Promise<void> {
    // start 方法会在 mounted 时被调用
    // WebSocket server 的创建在 useContext("router") 中处理
  }

  async setupWebSocket(router: Router): Promise<void> {
    if (this.wss) return; // 已经设置过了
    // 创建 WebSocket server
    this.wss = router.ws("/sandbox");

    this.wss.on("connection", (ws: WebSocket, req) => {
      // 为每个连接创建一个唯一的 bot 名称
      const botName = `sandbox-${Math.random().toString(36).slice(2, 9)}`;
      logger.debug(`New sandbox connection: ${botName} from ${req.socket.remoteAddress}`);

      // 创建 bot 配置
      const config: SandboxConfig = {
        context: "sandbox",
        ws,
        name: botName,
      };

      // 创建并连接 bot
      const bot = this.createBot(config);
      bot.$connect();

      // WebSocket 关闭时清理
      ws.on("close", () => {
        logger.debug(`Sandbox connection closed: ${botName}`);
        this.bots.delete(bot.$id);
      });

      ws.on("error", (error) => {
        logger.error(`Sandbox WebSocket error for ${botName}:`, error);
      });
    });

    logger.info("Sandbox WebSocket server started at /sandbox");
  }
}

const { provide } = usePlugin();

provide({
  name: "sandbox",
  description: "Sandbox Adapter",
  mounted: async (p: Plugin) => {
    const adapter = new SandboxAdapter(p);
    await adapter.start();
    return adapter;
  },
  dispose: async (adapter: SandboxAdapter) => {
    // 关闭所有 bot 连接
    for (const bot of adapter.bots.values()) {
      await bot.$disconnect();
    }
    // 关闭 WebSocket server
    adapter.wss?.close();
    await adapter.stop();
  },
});

// 使用 router 上下文创建 WebSocket server
plugin.useContext("router", async (router: Router) => {
  // 等待 sandbox adapter 就绪
  plugin.useContext("sandbox", async (adapter: SandboxAdapter) => {
    await adapter.setupWebSocket(router);
  });
});

// 使用 web 上下文注册客户端入口
plugin.useContext("web", (web: any) => {
  // 注册 Sandbox 适配器的客户端入口文件
  const dispose = web.addEntry({
    production: path.resolve(import.meta.dirname, "../dist/index.js"),
    development: path.resolve(import.meta.dirname, "../client/index.tsx"),
  });
  return dispose;
});
