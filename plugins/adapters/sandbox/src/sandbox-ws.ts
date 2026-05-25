/**
 * Sandbox 传输 — Node WebSocket；Edge HTTP+SSE（见 sandbox-sse-hub / fetch-sse）。
 */
import { EventEmitter } from "node:events";
import { broadcastSandboxSse, closeSandboxSseSession } from "./sandbox-sse-hub.js";
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

export interface SandboxWsConfig {
  context: "sandbox";
  ws?: SandboxWsSocket;
  name: string;
  owner?: string;
  /** yaml 预置名：启动时占位，WS 连接前在 bot:list 显示为离线 */
  offline?: boolean;
}

/** 无 WS 时的占位 socket（仅用于 bot:list，不可收发） */
export function createOfflineSandboxWs(): SandboxWsSocket {
  return { send: () => {}, close: () => {} };
}

export function createSandboxSseTransport(
  sessionId: string,
  onClose?: () => void,
): SandboxWsSocket & { sessionId: string } {
  return {
    sessionId,
    send(data: string) {
      broadcastSandboxSse(sessionId, data);
    },
    close() {
      closeSandboxSseSession(sessionId);
      onClose?.();
    },
  };
}

/** 兼容 `ws` 包与标准 WebSocket */
export type SandboxWsSocket = {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on?(event: "message" | "close" | "error", listener: (...args: unknown[]) => void): void;
  off?(
    event: "message" | "close" | "error",
    listener: (...args: unknown[]) => void,
  ): void;
  addEventListener?(
    type: "message" | "close" | "error",
    listener: (ev: Event | MessageEvent | CloseEvent) => void,
  ): void;
  removeEventListener?(
    type: "message" | "close" | "error",
    listener: (ev: Event | MessageEvent | CloseEvent) => void,
  ): void;
};

export type SandboxBotDefaults = {
  name: string;
  owner: string;
  /** true：每连接随机 bot 名（Node 本地默认）；false：固定 name（Edge 单实例） */
  randomNamePerConnection?: boolean;
};

export type SandboxTransport = "websocket" | "http-sse";

export type ResolvedSandboxBot = {
  context: "sandbox";
  name: string;
  owner: string;
  randomNamePerConnection: boolean;
  transport: SandboxTransport;
};

function envVar(key: string): string | undefined {
  const g = globalThis as {
    Deno?: { env: { get(k: string): string | undefined } };
    process?: { env: Record<string, string | undefined> };
  };
  return g.Deno?.env.get(key) ?? g.process?.env[key];
}

export function resolveSandboxBot(
  appConfig: Record<string, unknown>,
): ResolvedSandboxBot {
  const bots = appConfig.bots as Array<Record<string, unknown>> | undefined;
  const entry = bots?.find((b) => b.context === "sandbox");
  const fixedName = typeof entry?.name === "string" ? entry.name : undefined;
  const name =
    fixedName ||
    envVar("SANDBOX_BOT_NAME") ||
    "sandbox-bot";
  const owner =
    (typeof entry?.owner === "string" && entry.owner) ||
    envVar("SANDBOX_BOT_OWNER") ||
    "sandbox-user";
  const transportRaw =
    (typeof entry?.transport === "string" && entry.transport) ||
    envVar("SANDBOX_TRANSPORT") ||
    "websocket";
  const transport: SandboxTransport =
    transportRaw === "http-sse" || transportRaw === "sse" ? "http-sse" : "websocket";
  return {
    context: "sandbox",
    name,
    owner,
    randomNamePerConnection: !fixedName,
    transport,
  };
}

/** 标准 WebSocket 在 upgrade 后可能尚未 OPEN；Node `ws` 在 connection 回调里通常已可 send */
function whenWsOpen(ws: SandboxWsSocket, fn: () => void): void {
  const std = ws as WebSocket;
  if (typeof std.readyState === "number") {
    if (std.readyState === WebSocket.OPEN) {
      fn();
      return;
    }
    std.addEventListener("open", fn, { once: true });
    return;
  }
  fn();
}

export function bindSandboxWsSocket(
  ws: SandboxWsSocket,
  handlers: {
    onMessage: (raw: string) => void;
    onClose: () => void;
    onError?: (err: unknown) => void;
  },
): () => void {
  if (typeof ws.on === "function") {
    const onMessage = (...args: unknown[]) => {
      const data = args[0];
      const raw = typeof data === "string"
        ? data
        : data instanceof ArrayBuffer
        ? new TextDecoder().decode(data)
        : Buffer.isBuffer(data)
        ? data.toString()
        : String(data ?? "");
      handlers.onMessage(raw);
    };
    ws.on("message", onMessage);
    ws.on("close", handlers.onClose);
    if (handlers.onError) ws.on("error", handlers.onError);
    return () => {
      ws.off?.("message", onMessage);
      ws.off?.("close", handlers.onClose);
      if (handlers.onError) ws.off?.("error", handlers.onError);
    };
  }
  const onMessage = (ev: Event) => {
    const data = (ev as MessageEvent).data;
    handlers.onMessage(typeof data === "string" ? data : "");
  };
  const onClose = () => handlers.onClose();
  const onError = handlers.onError
    ? () => handlers.onError?.(new Error("WebSocket error"))
    : undefined;
  ws.addEventListener!("message", onMessage);
  ws.addEventListener!("close", onClose);
  if (onError) ws.addEventListener!("error", onError);
  return () => {
    ws.removeEventListener!("message", onMessage);
    ws.removeEventListener!("close", onClose);
    if (onError) ws.removeEventListener!("error", onError);
  };
}

export function parseSandboxWsPayload(raw: string): {
  type: MessageType;
  id: string;
  content: MessageElement[];
  timestamp: number;
} {
  let payload: {
    type?: MessageType;
    id?: string;
    content?: MessageElement[] | string;
    text?: string;
    timestamp?: number;
  };
  try {
    payload = JSON.parse(raw) as typeof payload;
  } catch {
    payload = { text: raw };
  }
  const type = (payload.type as MessageType) ?? "private";
  const id = payload.id ?? "sandbox-user";
  const content: MessageElement[] = typeof payload.content === "string"
    ? [{ type: "text", data: { text: payload.content } }]
    : Array.isArray(payload.content)
    ? payload.content
    : [{ type: "text", data: { text: payload.text ?? raw } }];
  return { type, id, content, timestamp: payload.timestamp ?? Date.now() };
}

type BotEvent = {
  content: MessageElement[];
  type: MessageType;
  id: string;
  ts: number;
};

export class SandboxWsBot extends EventEmitter implements Bot<SandboxWsConfig, BotEvent> {
  $connected = false;
  #unbind: (() => void) | null = null;

  get $id() {
    return this.$config.name;
  }

  constructor(
    public adapter: SandboxWsHostAdapter,
    public $config: SandboxWsConfig,
  ) {
    super();
  }

  async $connect(): Promise<void> {
    if (this.$config.offline || !this.$config.ws) return;
    const ws = this.$config.ws;
    if (typeof ws.on !== "function" && typeof ws.addEventListener !== "function") {
      this.$connected = true;
      return;
    }
    this.#unbind = bindSandboxWsSocket(ws, {
      onMessage: (raw) => {
        const { type, id, content, timestamp } = parseSandboxWsPayload(raw);
        this.adapter.emit(
          "message.receive",
          this.$formatMessage({ content, type, id, ts: timestamp }),
        );
      },
      onClose: () => {
        this.$connected = false;
        if (!this.$config.offline) {
          this.adapter.bots.delete(this.$id);
        }
      },
      onError: (err) => {
        this.adapter.logger.warn(
          `sandbox ws error (${this.$config.name}): ${err instanceof Error ? err.message : String(err)}`,
        );
      },
    });
    this.$connected = true;
  }

  async $disconnect(): Promise<void> {
    this.#unbind?.();
    this.#unbind = null;
    this.$config.ws?.close();
    this.$connected = false;
  }

  $formatMessage({ content, type, id, ts }: BotEvent) {
    if (!this.$config.owner) this.$config.owner = id;
    const message = Message.from<BotEvent>(
      { content, type, id, ts },
      {
        $id: `${ts}`,
        $adapter: "sandbox" as const,
        $bot: this.$config.name,
        $sender: { id, name: "mock" },
        $channel: { id, type },
        $content: content,
        $raw: segment.raw(content),
        $timestamp: ts,
        $recall: async () => {},
        $reply: async (replyContent: SendContent, quote?: boolean | string) => {
          const normalized = Array.isArray(replyContent) ? replyContent : [replyContent];
          if (quote) {
            normalized.unshift({
              type: "reply",
              data: {
                id: typeof quote === "boolean" ? message.$id : quote,
              },
            });
          }
          return await this.adapter.sendMessage({
            context: "sandbox",
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
    const ws = this.$config.ws;
    if (!ws) return "";
    ws.send(
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

export class SandboxWsHostAdapter extends Adapter<SandboxWsBot> {
  readonly #sseSessions = new Map<string, string>();

  constructor(
    plugin: Plugin,
    protected readonly defaults: ResolvedSandboxBot,
  ) {
    super(plugin, "sandbox" as keyof Plugin.Contexts, []);
  }

  get transport(): SandboxTransport {
    return this.defaults.transport;
  }

  hasSseSession(sessionId: string): boolean {
    return this.#sseSessions.has(sessionId);
  }

  getBotBySseSession(sessionId: string): SandboxWsBot | undefined {
    const name = this.#sseSessions.get(sessionId);
    return name ? this.bots.get(name) : undefined;
  }

  createBot(config: SandboxWsConfig): SandboxWsBot {
    const bot = new SandboxWsBot(this, config);
    this.bots.set(bot.$id, bot);
    return bot;
  }

  /** `zhin.config.yml` 中 `context: sandbox` + 固定 `name` 时，启动即出现在 bot:list（离线） */
  registerConfiguredPlaceholder(): void {
    if (this.defaults.randomNamePerConnection) return;
    if (this.bots.has(this.defaults.name)) return;
    this.createBot({
      context: "sandbox",
      name: this.defaults.name,
      owner: this.defaults.owner,
      ws: createOfflineSandboxWs(),
      offline: true,
    });
  }

  /** Edge / 外部 upgrade：注入已建立的 WebSocket */
  acceptWebSocket(
    ws: SandboxWsSocket,
    overrides?: Partial<Pick<SandboxWsConfig, "name" | "owner">>,
  ): SandboxWsBot {
    const name = overrides?.name ??
      (this.defaults.randomNamePerConnection
        ? `sandbox-${crypto.randomUUID().slice(0, 8)}`
        : this.defaults.name);
    const owner = overrides?.owner ?? this.defaults.owner;
    const existing = this.bots.get(name);
    if (existing) {
      void existing.$disconnect();
      this.bots.delete(name);
    }
    const bot = this.createBot({ context: "sandbox", ws, name, owner, offline: false });
    void bot.$connect();
    if (!this.defaults.randomNamePerConnection) {
      const readyPayload = JSON.stringify({
        type: "ready",
        id: owner,
        bot: name,
        content: [
          {
            type: "text",
            data: {
              text: [
                `已连接 Sandbox「${name}」`,
                "与 Node Host 控制台沙盒协议一致（/sandbox）",
                "命令: help · ping · zt · status",
              ].join("\n"),
            },
          },
        ],
        timestamp: Date.now(),
      });
      whenWsOpen(ws, () => ws.send(readyPayload));
    }
    return bot;
  }

  /** Edge SSE：建立会话并绑定固定 bot */
  acceptSseSession(
    sessionId: string,
    overrides?: Partial<Pick<SandboxWsConfig, "name" | "owner">>,
  ): SandboxWsBot {
    const name = overrides?.name ?? this.defaults.name;
    const owner = overrides?.owner ?? this.defaults.owner;
    const existing = this.bots.get(name);
    if (existing) {
      void existing.$disconnect();
      this.bots.delete(name);
    }
    const ws = createSandboxSseTransport(sessionId, () => {
      this.#sseSessions.delete(sessionId);
      this.bots.delete(name);
    });
    const bot = this.createBot({ context: "sandbox", ws, name, owner, offline: false });
    this.#sseSessions.set(sessionId, name);
    void bot.$connect();
    if (!this.defaults.randomNamePerConnection) {
      const readyPayload = JSON.stringify({
        type: "ready",
        id: owner,
        bot: name,
        content: [
          {
            type: "text",
            data: {
              text: [
                `已连接 Sandbox「${name}」`,
                "传输: HTTP + SSE（Edge）",
                "命令: help · ping · zt · status",
              ].join("\n"),
            },
          },
        ],
        timestamp: Date.now(),
      });
      ws.send(readyPayload);
    }
    return bot;
  }

  /** POST /sandbox/message — 与 WebSocket 帧同格式的 JSON 字符串 */
  ingestSseClientMessage(sessionId: string, raw: string): void {
    const bot = this.getBotBySseSession(sessionId);
    if (!bot || !bot.$connected) {
      throw new Error(`sandbox session not connected: ${sessionId}`);
    }
    const { type, id, content, timestamp } = parseSandboxWsPayload(raw);
    this.emit(
      "message.receive",
      bot.$formatMessage({ content, type, id, ts: timestamp }),
    );
  }
}

