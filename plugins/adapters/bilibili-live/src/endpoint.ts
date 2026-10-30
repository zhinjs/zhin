/**
 * Bilibili 直播弹幕 Endpoint（Experimental）。
 *
 * - 入站：连弹幕 WebSocket，认证后每 30 秒心跳；每条 `DANMU_MSG` 进一条 canonical 消息。
 *   Adapter 声明 `liveDanmaku`，Agent 按 ADR 0038 §5 把弹幕收进窗口、一窗只回一次、只用只读工具。
 * - 出站：`sendMode: direct` 时把回复切成至多 `maxChunks` 条弹幕直接发出（需登录）；`off` 只听不说。
 * - 风控即熔断：发送遇到频控 / 风控错误码后停止发送，直到重启。
 * - 不落盘：所有状态都在内存里，且有上限。
 */
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
import { BilibiliLiveApiError, BilibiliLiveClient, type BilibiliLiveFetch } from './client.js';
import {
  BILIBILI_LIVE_HEARTBEAT_MS,
  LIVE_OP,
  decodeLiveFrame,
  encodeLivePacket,
  formatOutboundDanmaku,
  parseDanmaku,
  splitDanmaku,
  type LiveDanmaku,
  type ResolvedBilibiliLiveConfig,
} from './protocol.js';

/** 最小 WebSocket 面（全局 WebSocket 或测试替身）。 */
export interface LiveSocket {
  binaryType: string;
  send(data: Uint8Array): void;
  close(): void;
  addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (event: { data?: unknown; code?: number }) => void): void;
}

export type LiveSocketFactory = (url: string) => LiveSocket;

export interface BilibiliLiveEndpointOptions {
  readonly id: CapabilityId;
  readonly signal?: AbortSignal;
  readonly config: ResolvedBilibiliLiveConfig;
  readonly fetch?: BilibiliLiveFetch;
  readonly socket?: LiveSocketFactory;
  readonly now?: () => number;
  /** 两条分片弹幕之间的等待（测试用）。 */
  readonly chunkDelayMs?: number;
}

/** 去重窗口：最近这么多条弹幕 id。 */
const SEEN_CAPACITY = 500;
/** 认证回包等待上限。 */
const AUTH_TIMEOUT_MS = 15_000;
const DEFAULT_CHUNK_DELAY_MS = 1_200;

export class BilibiliLiveEndpoint extends BilibiliLiveClient implements Endpoint {
  readonly [endpointSpec]: EndpointSpecification;
  readonly #options: BilibiliLiveEndpointOptions;
  readonly #logger: ReturnType<typeof getAdapterLogger>;
  readonly #lifecycle: EndpointLifecycle;
  readonly #seen = new Set<string>();
  #roomId?: string;
  #socket?: LiveSocket;
  #open = false;
  #sequence = 0;
  #lastSentAt = 0;
  #sending = false;
  #tripped?: { readonly code: number; readonly message: string };

  constructor(options: BilibiliLiveEndpointOptions) {
    super(options.config, options.fetch ?? (globalThis.fetch as unknown as BilibiliLiveFetch), options.now, options.signal);
    this.#options = options;
    const readTransportState = () => this.#transportState;
    this[endpointSpec] = createEndpointSpecification(this, {
      name: options.config.id,
      start: () => this.#start(), open: () => this.#openEndpoint(),
      close: () => this.#close(), stop: () => this.#stop(),
      send: request => this.#send(request),
      get transportState() { return readTransportState(); },
    });
    this.#logger = getAdapterLogger('bilibili-live', options.config.id);
    this.#lifecycle = createEndpointLifecycle({
      name: `bilibili-live:${options.config.id}`,
      heartbeat: { intervalMs: BILIBILI_LIVE_HEARTBEAT_MS, watchdogMisses: 3 },
    });
  }

  get #transportState(): EndpointTransportState {
    return this.#lifecycle.state;
  }

  /** 真实房间号（连上之后可用）。 */
  get roomId(): string | undefined {
    return this.#roomId;
  }

  /** 发送熔断原因；非空时不再发弹幕，需要人工处理后重启。 */
  get circuitBreaker(): Readonly<{ code: number; message: string }> | undefined {
    return this.#tripped;
  }

  get #now(): number {
    return (this.#options.now ?? Date.now)();
  }

  async #start(): Promise<void> {
    await this.#lifecycle.start((handle) => this.#connect(handle));
    this[endpointSpec].reportSelfUserId(this.selfUid);
    if (!this.selfUid) {
      this.#logger.warn(formatCompact({
        op: 'bilibili_live_anonymous',
        hint: '未登录：弹幕发送者昵称会被平台打码、uid 为 0，且无法发弹幕',
      }));
    }
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

  /** 每次（重）连都重新取 token：token 会过期。 */
  async #connect(handle: Parameters<Parameters<EndpointLifecycle['start']>[0]>[0]): Promise<void> {
    if (!this.#roomId) this.#roomId = (await this.resolveRoom()).roomId;
    const roomId = this.#roomId;
    const server = await this.getDanmuServer(roomId);
    const factory = this.#options.socket ?? ((url: string) => new globalThis.WebSocket(url) as unknown as LiveSocket);
    const socket = factory(server.url);
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
        settle(new Error('bilibili live auth timed out'));
        try { socket.close(); } catch { /* ignore */ }
      }, AUTH_TIMEOUT_MS);
      socket.addEventListener('open', () => {
        if (this.#socket !== socket || !this.#lifecycle.started) return;
        socket.send(encodeLivePacket(LIVE_OP.auth, this.authBody(roomId, server.token)));
      });
      socket.addEventListener('message', (event) => {
        if (this.#socket !== socket || !this.#lifecycle.started) return;
        this.#lifecycle.notifyHeartbeatAck();
        const frame = toBytes(event.data);
        if (!frame) return;
        for (const packet of decodeLiveFrame(frame)) {
          if (packet.op === LIVE_OP.authReply) {
            const code = (packet.body as { code?: unknown } | undefined)?.code;
            if (code === 0) {
              this.#lifecycle.startHeartbeat(() => socket.send(encodeLivePacket(LIVE_OP.heartbeat)));
              socket.send(encodeLivePacket(LIVE_OP.heartbeat));
              this.#logger.info(formatCompact({ op: 'bilibili_live_connected', room: roomId }));
              settle();
            } else {
              settle(new Error(`bilibili live auth rejected (code ${String(code)})`));
              try { socket.close(); } catch { /* ignore */ }
            }
          } else if (packet.op === LIVE_OP.message) {
            const danmaku = parseDanmaku(packet.body);
            if (danmaku) void this[endpointSpec].events.run(() => this.#admit(roomId, danmaku)).catch((error: unknown) => this.#logger.debug(formatCompact({
              op: 'bilibili_live_dispatch_failed', error: error instanceof Error ? error.message : String(error),
            })));
          }
        }
      });
      socket.addEventListener('close', (event) => {
        if (this.#socket === socket) this.#socket = undefined;
        handle.notifyClosed(new Error(`bilibili live socket closed (${event.code ?? 'unknown'})`));
        settle(new Error(`bilibili live socket closed before auth (${event.code ?? 'unknown'})`));
      });
      socket.addEventListener('error', () => {
        settle(new Error('bilibili live socket error'));
      });
    });
  }

  #conversation(roomId: string): ConversationRef {
    return {
      endpoint: this[endpointSpec].identity,
      kind: 'channel',
      id: roomId,
    };
  }

  async #admit(roomId: string, danmaku: LiveDanmaku): Promise<void> {
    if (!this.#open && !this.#lifecycle.started) return;
    const self = this.selfUid;
    if (self && danmaku.uid === self) return; // 防自回环
    this.#sequence += 1;
    const id = danmaku.id ?? `${danmaku.timestamp}-${danmaku.uid}-${this.#sequence}`;
    if (this.#seen.has(id)) return;
    this.#seen.add(id);
    if (this.#seen.size > SEEN_CAPACITY) {
      const oldest = this.#seen.values().next().value;
      if (oldest !== undefined) this.#seen.delete(oldest);
    }
    // 未登录时平台给 uid 0：按打码昵称区分观众，避免所有人被当成同一个人。
    const senderId = danmaku.uid !== '0' ? danmaku.uid : `anon:${danmaku.uname}`;
    const conversation = this.#conversation(roomId);
    void this[endpointSpec].events.platform('danmaku', danmaku).catch(() => undefined);
    await this[endpointSpec].events.message({
      event: danmaku,
      platformSentAt: danmaku.timestamp,
      conversation,
      message: { conversation, id },
      content: danmaku.text,
      sender: { id: senderId, name: danmaku.uname },
      endpointId: this.#options.config.id,
      metadata: Object.freeze({ roomId, liveDanmaku: true }),
    });
  }

  /** 出站 = 在直播间发弹幕。 */
  async #send({ conversation, payload, signal }: EndpointSendRequest): Promise<string> {
    const config = this.#options.config;
    if (config.sendMode === 'off') {
      throw new EndpointDeliveryError('send_disabled', 'Bilibili live sendMode is off', 'not_sent');
    }
    const roomId = this.#roomId;
    if (!roomId || conversation.id !== roomId) {
      throw new EndpointDeliveryError('invalid_recipient',
        `Bilibili live can only post to its own room ${roomId ?? config.roomId}, got "${conversation.id}"`, 'not_sent');
    }
    if (this.#tripped) {
      throw new EndpointDeliveryError('circuit_open', `Bilibili live sending stopped after code ${this.#tripped.code}`, 'not_sent');
    }
    if (!this.canWrite) {
      throw new EndpointDeliveryError('not_logged_in', 'Sending danmaku requires SESSDATA and bili_jct', 'not_sent');
    }
    const { text, replyUid } = formatOutboundDanmaku(payload);
    const chunks = splitDanmaku(text, config.maxLength, config.maxChunks);
    if (chunks.length === 0) throw new EndpointDeliveryError('invalid_payload', 'Danmaku is empty', 'not_sent');
    const now = this.#now;
    if (this.#sending || now - this.#lastSentAt < config.minSendIntervalMs) {
      throw new EndpointDeliveryError('rate_limited', 'Bilibili live minimum send interval not reached', 'not_sent');
    }
    this.#sending = true;
    this.#lastSentAt = now;
    let delivered = 0;
    try {
      for (const chunk of chunks) {
        signal?.throwIfAborted();
        if (delivered > 0) await delay(this.#options.chunkDelayMs ?? DEFAULT_CHUNK_DELAY_MS, signal);
        signal?.throwIfAborted();
        await this.sendDanmaku(roomId, chunk, delivered === 0 ? replyUid : undefined);
        delivered += 1;
      }
    } catch (error) {
      if (error instanceof BilibiliLiveApiError && error.risk) {
        this.#tripped = Object.freeze({ code: error.code, message: error.message });
        this.#logger.warn(formatCompact({ op: 'bilibili_live_circuit_open', code: error.code }));
      }
      const message = error instanceof Error ? error.message : String(error);
      // 第一条就失败 = 没发出去；中途失败 = 观众已经看到一部分。
      throw new EndpointDeliveryError('platform_error', message, delivered === 0 ? 'not_sent' : 'unknown', { cause: error });
    } finally {
      this.#sending = false;
    }
    this.#logger.info(formatCompact({ op: 'bilibili_live_sent', room: roomId, chunks: delivered }));
    return `${roomId}:${now}`;
  }
}

function toBytes(data: unknown): Uint8Array | undefined {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return undefined;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal?.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}
