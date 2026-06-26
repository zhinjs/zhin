/** Sandbox 传输 — Node WebSocket。 */
import { EventEmitter } from "node:events";
import {
  Adapter,
  Endpoint,
  Message,
  segment,
  type MessageElement,
  type MessageType,
  type Plugin,
  type SendContent,
  type SendOptions,} from 'zhin.js';

export interface SandboxWsConfig {
  context: "sandbox";
  ws?: SandboxWsSocket;
  name: string;
  owner?: string;
  /** yaml 预置名：启动时占位，WS 连接前在 endpoint:list 显示为离线 */
  offline?: boolean;
}

/** 无 WS 时的占位 socket（仅用于 endpoint:list，不可收发） */
export function createOfflineSandboxWs(): SandboxWsSocket {
  return { send: () => {}, close: () => {} };
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
  /** true：每连接随机 bot 名（Node 本地默认）；false：固定 name */
  randomNamePerConnection?: boolean;
};

export type ResolvedSandboxBot = {
  context: "sandbox";
  name: string;
  owner: string;
  randomNamePerConnection: boolean;
};

function envVar(key: string): string | undefined {
  const g = globalThis as {
    Deno?: { env: { get(k: string): string | undefined } };
    process?: { env: Record<string, string | undefined> };
  };
  return g.Deno?.env.get(key) ?? g.process?.env[key];
}

export function resolveSandboxEndpoint(
  appConfig: Record<string, unknown>,
): ResolvedSandboxBot {
  const endpoints = appConfig.endpoints as Array<Record<string, unknown>> | undefined;
  const entry = endpoints?.find((b) => b.context === "sandbox");
  const fixedName = typeof entry?.name === "string" ? entry.name : undefined;
  const name =
    fixedName ||
    envVar("SANDBOX_BOT_NAME") ||
    "sandbox-bot";
  const owner =
    (typeof entry?.owner === "string" && entry.owner) ||
    envVar("SANDBOX_BOT_OWNER") ||
    "sandbox-user";
  return {
    context: "sandbox",
    name,
    owner,
    randomNamePerConnection: !fixedName,
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

type EndpointEvent = {
  content: MessageElement[];
  type: MessageType;
  id: string;
  ts: number;
};

export class SandboxWsEndpoint extends EventEmitter implements Endpoint<SandboxWsConfig, EndpointEvent> {
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
          this.adapter.endpoints.delete(this.$id);
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

  $formatMessage({ content, type, id, ts }: EndpointEvent) {
    if (!this.$config.owner) this.$config.owner = id;
    const message = Message.from<EndpointEvent>(
      { content, type, id, ts },
      {
        $id: `${ts}`,
        $adapter: "sandbox" as const,
        $endpoint: this.$config.name,
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
            endpoint: this.$config.name,
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
    options = {
      ...options,

    };
    if (!this.$connected) return "";
    const ws = this.$config.ws;
    if (!ws) return "";
    const messageId = `sb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    ws.send(
      JSON.stringify({
        ...options,
        messageId,
        content: options.content,
        timestamp: Date.now(),
      }),
    );
    return messageId;
  }

  async $editMessage(options: import('zhin.js').EditMessageOptions): Promise<void> {
    if (!this.$connected) return;
    const ws = this.$config.ws;
    if (!ws) return;
    ws.send(
      JSON.stringify({
        type: 'edit',
        messageId: options.messageId,
        context: options.context,
        endpoint: options.endpoint,
        id: options.id,
        channelType: options.type,
        content: options.content,
        timestamp: Date.now(),
      }),
    );
  }

  async $recallMessage(_id: string): Promise<void> {}
}

export class SandboxWsHostAdapter extends Adapter<SandboxWsEndpoint> {
  static override readonly capabilities = ['inbound', 'outbound'] as const;
  static override interactivePolicy = 'native' as const;

  constructor(
    plugin: Plugin,
    protected readonly defaults: ResolvedSandboxBot,
  ) {
    super(plugin, "sandbox" as keyof Plugin.Contexts, []);
  }

  getOutboundMediaCapabilities() {
    return {
      image: true,
      audio: true,
      video: true,
      file: true,
      maxAttachmentBytes: 26_214_400,
    };
  }

  createEndpoint(config: SandboxWsConfig): SandboxWsEndpoint {
    const endpoint = new SandboxWsEndpoint(this, config);
    this.endpoints.set(endpoint.$id, endpoint);
    return endpoint;
  }

  /** `zhin.config.yml` 中 `context: sandbox` + 固定 `name` 时，启动即出现在 endpoint:list（离线） */
  registerConfiguredPlaceholder(): void {
    if (this.defaults.randomNamePerConnection) return;
    if (this.endpoints.has(this.defaults.name)) return;
    this.createEndpoint({
      context: "sandbox",
      name: this.defaults.name,
      owner: this.defaults.owner,
      ws: createOfflineSandboxWs(),
      offline: true,
    });
  }

  /** 外部 upgrade：注入已建立的 WebSocket */
  acceptWebSocket(
    ws: SandboxWsSocket,
    overrides?: Partial<Pick<SandboxWsConfig, "name" | "owner">>,
  ): SandboxWsEndpoint {
    const name = overrides?.name ??
      (this.defaults.randomNamePerConnection
        ? `sandbox-${crypto.randomUUID().slice(0, 8)}`
        : this.defaults.name);
    const owner = overrides?.owner ?? this.defaults.owner;
    const existing = this.endpoints.get(name);
    if (existing) {
      void existing.$disconnect();
      this.endpoints.delete(name);
    }
    const endpoint = this.createEndpoint({ context: "sandbox", ws, name, owner, offline: false });
    void endpoint.$connect();
    if (!this.defaults.randomNamePerConnection) {
      const readyPayload = JSON.stringify({
        type: "ready",
        id: owner,
        endpoint: name,
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
    return endpoint;
  }
}

