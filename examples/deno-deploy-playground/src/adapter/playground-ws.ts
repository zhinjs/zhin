/**
 * Playground WebSocket 适配器 — 行为对齐 @zhin.js/adapter-sandbox，供 Deno Deploy 使用标准 WebSocket API。
 */
import { EventEmitter } from "node:events";
import {
  Adapter,
  Bot,
  Message,
  segment,
  type MessageElement,
  type MessageType,
  type Plugin,
  type SendContent,
  type SendOptions,
} from "zhin.js";

export interface PlaygroundWsConfig {
  context: "playground";
  ws: WebSocket;
  name: string;
  owner?: string;
}

declare module "zhin.js" {
  interface Adapters {
    playground: PlaygroundWsAdapter;
  }
}

type BotEvent = { content: MessageElement[]; type: MessageType; id: string; ts: number };

export class PlaygroundWsBot extends EventEmitter implements Bot<
  PlaygroundWsConfig,
  BotEvent
> {
  $connected = false;

  get $id() {
    return this.$config.name;
  }

  constructor(
    public adapter: PlaygroundWsAdapter,
    public $config: PlaygroundWsConfig,
  ) {
    super();
    const ws = $config.ws;
    ws.addEventListener("message", (ev) => {
      const text = typeof ev.data === "string" ? ev.data : "";
      let payload: {
        type?: MessageType;
        id?: string;
        content?: MessageElement[] | string;
        text?: string;
        timestamp?: number;
      };
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { text };
      }

      const channelType = (payload.type as MessageType) ?? "private";
      const channelId = payload.id ?? "playground-user";
      const content: MessageElement[] = typeof payload.content === "string"
        ? [{ type: "text", data: { text: payload.content } }]
        : Array.isArray(payload.content)
        ? payload.content
        : [{ type: "text", data: { text: payload.text ?? text } }];

      const ts = payload.timestamp ?? Date.now();
      const msg = this.$formatMessage({
        content,
        type: channelType,
        id: channelId,
        ts,
      });
      this.adapter.emit("message.receive", msg);
    });

    ws.addEventListener("close", () => {
      this.$connected = false;
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

  $formatMessage({ content, type, id, ts }: BotEvent) {
    if (!this.$config.owner) this.$config.owner = id;
    const message = Message.from<BotEvent>(
      { content, type, id, ts },
      {
        $id: `${ts}`,
        $adapter: "playground" as const,
        $bot: this.$config.name,
        $sender: { id, name: "playground" },
        $channel: { id, type },
        $content: content,
        $raw: segment.raw(content),
        $timestamp: ts,
        $recall: async () => {},
        $reply: async (replyContent: SendContent) => {
          const normalized = Array.isArray(replyContent) ? replyContent : [replyContent];
          return await this.adapter.sendMessage({
            context: "playground",
            bot: this.$config.name,
            content: normalized,
            id,
            type,
          });
        },
      },
    );
    return message;
  }

  async $sendMessage(options: SendOptions): Promise<string> {
    if (!this.$connected) return "";
    this.$config.ws.send(
      JSON.stringify({
        ...options,
        content: options.content,
        timestamp: Date.now(),
      }),
    );
    return "";
  }

  async $recallMessage(_id: string): Promise<void> {}
}

export class PlaygroundWsAdapter extends Adapter<PlaygroundWsBot> {
  constructor(plugin: Plugin) {
    super(plugin, "playground" as keyof Plugin.Contexts, []);
  }

  createBot(config: PlaygroundWsConfig): PlaygroundWsBot {
    const bot = new PlaygroundWsBot(this, config);
    this.bots.set(bot.$id, bot);
    return bot;
  }

  /** Deno Deploy：由 HTTP 层 upgrade 后注入连接 */
  acceptSocket(ws: WebSocket): void {
    const name = `playground-${crypto.randomUUID().slice(0, 8)}`;
    const bot = this.createBot({ context: "playground", ws, name });
    bot.$connect();
  }
}
