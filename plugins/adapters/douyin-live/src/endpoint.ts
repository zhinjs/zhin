/**
 * 抖音直播弹幕 Endpoint（Experimental，非官方协议）。
 *
 * - 入站：web_rid → 内部 room_id → 连弹幕 WebSocket（轻量 WSS，不起浏览器 / CDP）；10 秒 `hb` 心跳，
 *   `needAck` 时回 ack；每条 `WebcastChatMessage` 进一条 canonical 消息，其余类型（礼物 / 进场 / 点赞 / 关注）忽略。
 *   Adapter 声明 `liveDanmaku`，Agent 按 ADR 0038 §5 把弹幕收进窗口、一窗只回一次、只用只读工具。
 * - 断线走 `createEndpointLifecycle` 退避重连，每次重连重新解析 room_id、重建签名地址。
 * - 出站（sendMode α）：默认 `off` 只听不说。
 * - 不落盘：所有状态都在内存里，且有上限。
 */
import WebSocket from 'ws';
import { EndpointDeliveryError, type ConversationRef } from '@zhin.js/im-contract';
import {
  createEndpointSpecification, endpointSpec, type Endpoint, type EndpointSpecification,
  createEndpointLifecycle,
  type EndpointLifecycle,
  type EndpointSendRequest,
  type EndpointTransportState,
} from 'zhin.js/adapter';
import { formatCompact, getAdapterLogger } from '@zhin.js/logger';
import type { CapabilityId } from 'zhin.js';
import { DOUYIN_LIVE_USER_AGENT, DouyinLiveClient, type DouyinLiveFetch, type DouyinLiveSigner } from './client.js';
import {
  DOUYIN_LIVE_HEARTBEAT_MS,
  decodeWebcastFrame,
  encodeAck,
  encodeHeartbeat,
  parseChatMessage,
  type DouyinLiveChat,
  type ResolvedDouyinLiveConfig,
} from './protocol.js';

/** 最小 WebSocket 面（`ws` 或测试替身）。 */
export interface LiveSocket {
  binaryType: string;
  send(data: Uint8Array): void;
  close(): void;
  addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (event: { data?: unknown; code?: number }) => void): void;
}

/** 建连：需要自定义 `cookie` / `user-agent` 请求头，所以默认用 `ws` 而不是全局 WebSocket。 */
export type LiveSocketFactory = (url: string, headers: Readonly<Record<string, string>>) => LiveSocket;

export interface DouyinLiveEndpointOptions {
  readonly id: CapabilityId;
  readonly signal?: AbortSignal;
  readonly config: ResolvedDouyinLiveConfig;
  readonly fetch?: DouyinLiveFetch;
  readonly socket?: LiveSocketFactory;
  /** 可选签名函数（优先于 `config.signerUrl`）。 */
  readonly sign?: DouyinLiveSigner;
  readonly now?: () => number;
  /** 固定游客设备 id（测试用）。 */
  readonly userUniqueId?: string;
}

/** 去重窗口：最近这么多条弹幕 id。 */
const SEEN_CAPACITY = 500;
/** 握手等待上限。 */
const OPEN_TIMEOUT_MS = 15_000;

const defaultSocket: LiveSocketFactory = (url, headers) => new WebSocket(url, { headers: { ...headers } }) as unknown as LiveSocket;

export class DouyinLiveEndpoint extends DouyinLiveClient implements Endpoint {
  readonly [endpointSpec]: EndpointSpecification;
  readonly #options: DouyinLiveEndpointOptions;
  readonly #logger: ReturnType<typeof getAdapterLogger>;
  readonly #lifecycle: EndpointLifecycle;
  readonly #seen = new Set<string>();
  #internalRoomId?: string;
  #socket?: LiveSocket;
  #open = false;
  #sequence = 0;
  #warnedUnsigned = false;

  constructor(options: DouyinLiveEndpointOptions) {
    super(options.config, options.fetch ?? (globalThis.fetch as unknown as DouyinLiveFetch), {
      ...(options.now ? { now: options.now } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.sign ? { sign: options.sign } : {}),
      ...(options.userUniqueId ? { userUniqueId: options.userUniqueId } : {}),
    });
    this.#options = options;
    const readTransportState = () => this.#transportState;
    this[endpointSpec] = createEndpointSpecification(this, {
      name: options.config.id,
      start: () => this.#start(), open: () => this.#openEndpoint(),
      close: () => this.#close(), stop: () => this.#stop(),
      send: request => this.#send(request),
      get transportState() { return readTransportState(); },
    });
    this.#logger = getAdapterLogger('douyin-live', options.config.id);
    this.#lifecycle = createEndpointLifecycle({
      name: `douyin-live:${options.config.id}`,
      heartbeat: { intervalMs: DOUYIN_LIVE_HEARTBEAT_MS, watchdogMisses: 3 },
    });
  }

  get #transportState(): EndpointTransportState {
    return this.#lifecycle.state;
  }

  /** web_rid（会话 id，与配置 `roomId` 一致）。 */
  get webRid(): string {
    return this.config.roomId;
  }

  /** 平台内部 room_id（连上之后可用）。 */
  get internalRoomId(): string | undefined {
    return this.#internalRoomId;
  }

  async #start(): Promise<void> {
    await this.#lifecycle.start((handle) => this.#connect(handle));
  }

  #openEndpoint(): void {
    this.#open = true;
  }

  #close(): void {
    this.#open = false;
  }

  async #stop(): Promise<void> {
    this.#open = false;
    await this.#lifecycle.stop();
    this.#socket = undefined;
    this.#seen.clear();
  }

  /** 每次（重）连都重新解析 room_id、重新生成签名地址。 */
  async #connect(handle: Parameters<Parameters<EndpointLifecycle['start']>[0]>[0]): Promise<void> {
    const { roomId } = await this.resolveRoom();
    this.#internalRoomId = roomId;
    if (!this.canSign && !this.#warnedUnsigned) {
      this.#warnedUnsigned = true;
      this.#logger.warn(formatCompact({
        op: 'douyin_live_unsigned',
        hint: '未配置 signerUrl：WebSocket 不带 signature 连接，平台可能拒绝握手',
      }));
    }
    const url = await this.buildPushUrl(roomId);
    const factory = this.#options.socket ?? defaultSocket;
    const socket = factory(url, { cookie: this.cookieHeader(), 'user-agent': DOUYIN_LIVE_USER_AGENT });
    socket.binaryType = 'arraybuffer';
    this.#socket = socket;
    handle.onForceClose(() => {
      try { socket.close(); } catch { /* ignore */ }
    });
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error); else resolve();
      };
      const timer = setTimeout(() => {
        settle(new Error('douyin live socket open timed out'));
        try { socket.close(); } catch { /* ignore */ }
      }, OPEN_TIMEOUT_MS);
      socket.addEventListener('open', () => {
        if (this.#socket !== socket || !this.#lifecycle.started) return;
        this.#lifecycle.startHeartbeat(() => socket.send(encodeHeartbeat()));
        socket.send(encodeHeartbeat());
        this.#logger.info(formatCompact({ op: 'douyin_live_connected', room: this.webRid }));
        settle();
      });
      socket.addEventListener('message', (event) => {
        if (this.#socket !== socket || !this.#lifecycle.started) return;
        this.#lifecycle.notifyHeartbeatAck();
        const bytes = toBytes(event.data);
        if (!bytes) return;
        const decoded = decodeWebcastFrame(bytes);
        const response = decoded?.response;
        if (!decoded || !response) return;
        if (response.needAck) {
          try { socket.send(encodeAck(decoded.frame.logId, response.internalExt)); } catch { /* closing */ }
        }
        for (const message of response.messages) {
          const chat = parseChatMessage(message, this.now);
          if (!chat) continue;
          void this[endpointSpec].events.run(() => this.#admit(roomId, chat)).catch((error: unknown) => this.#logger.debug(formatCompact({
            op: 'douyin_live_dispatch_failed', error: error instanceof Error ? error.message : String(error),
          })));
        }
      });
      socket.addEventListener('close', (event) => {
        if (this.#socket === socket) this.#socket = undefined;
        handle.notifyClosed(new Error(`douyin live socket closed (${event.code ?? 'unknown'})`));
        settle(new Error(`douyin live socket closed before open (${event.code ?? 'unknown'})`));
      });
      socket.addEventListener('error', () => {
        settle(new Error('douyin live socket error'));
      });
    });
  }

  #conversation(): ConversationRef {
    return {
      endpoint: this[endpointSpec].identity,
      kind: 'channel',
      id: this.webRid,
    };
  }

  async #admit(roomId: string, chat: DouyinLiveChat): Promise<void> {
    if (!this.#open && !this.#lifecycle.started) return;
    this.#sequence += 1;
    const id = chat.id ?? `${chat.timestamp}-${chat.uid}-${this.#sequence}`;
    if (this.#seen.has(id)) return;
    this.#seen.add(id);
    if (this.#seen.size > SEEN_CAPACITY) {
      const oldest = this.#seen.values().next().value;
      if (oldest !== undefined) this.#seen.delete(oldest);
    }
    // 取不到 uid 时按昵称区分观众，避免所有人被当成同一个人。
    const senderId = chat.uid && chat.uid !== '0' ? chat.uid : `anon:${chat.nickname}`;
    const conversation = this.#conversation();
    void this[endpointSpec].events.platform('danmaku', chat).catch(() => undefined);
    await this[endpointSpec].events.message({
      event: chat,
      platformSentAt: chat.timestamp,
      conversation,
      message: { conversation, id },
      content: chat.text,
      sender: { id: senderId, name: chat.nickname },
      endpointId: this.#options.config.id,
      metadata: Object.freeze({ roomId: chat.roomId ?? roomId, liveDanmaku: true }),
    });
  }

  /** 出站（sendMode α）：当前只支持 `off`。 */
  async #send(_request: EndpointSendRequest): Promise<string> {
    throw new EndpointDeliveryError('send_disabled', 'Douyin live sendMode is off', 'not_sent');
  }
}

function toBytes(data: unknown): Uint8Array | undefined {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return undefined;
}
