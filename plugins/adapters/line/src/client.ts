import { LineApiClient } from './api-client.js';
import { EndpointDeliveryError } from '@zhin.js/im-contract';
/**
 * LineClient — lifecycle, outbound, admit, OpenAPI helpers for agent tools.
 */
import {
  type EndpointManagement,
  type EndpointSendRequest,
  type EndpointGroupRequest,
} from 'zhin.js/adapter';
import type { HttpHost, HttpRouteRegistration } from '@zhin.js/host-http';
import { formatCompact, getAdapterLogger } from '@zhin.js/logger';
import type { CapabilityId } from 'zhin.js';
import {
  formatInboundContent,
  formatOutboundMessages,
  generateMessageId,
  isLineLifecycleEvent,
  isMessageEvent,
  isValidLineRecipientId,
  lineInboundConversation,
  type LineApiResponse,
  type LineEvent,
  type ResolvedLineConfig,
} from './protocol.js';
import { registerLineWebhookRoutes } from './webhook.js';
import { receiveLineSideEvent } from './side-event-dispatch.js';

/** LINE replyToken 有效期短，过期后 reply 必 400；缓存带时间戳，超时弃用改走 push。 */
const REPLY_TOKEN_TTL_MS = 60_000;
/** 出站 HTTP 调用统一 30s 超时。 */
const OUTBOUND_TIMEOUT_MS = 30_000;

export type LineFetch = (
  url: string,
  init?: {
    readonly method?: string;
    readonly headers?: Record<string, string>;
    readonly body?: string;
    readonly signal?: AbortSignal;
  },
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}>;

export interface LineEndpointOptions {
  readonly id: CapabilityId;
  readonly http: HttpHost;
  readonly config: ResolvedLineConfig;
  readonly fetch?: LineFetch;
}

export class LineClient extends LineApiClient {
  readonly #logger!: ReturnType<typeof getAdapterLogger>;

  readonly #options: LineEndpointOptions;
  readonly #fetch: LineFetch;
  #routeReleases: HttpRouteRegistration[] = [];
  #replyTokenCache = new Map<string, { token: string; timestamp: number }>();
  readonly #admissions = new Map<string, { readonly promise: Promise<void>; expires: number }>();
  #open = false;
  #started = false;
  protected readonly endpointManagement: EndpointManagement = createLineEndpointManagement(this);

  protected configName(): string { return this.#options.config.id; }
  get transportState(): import('zhin.js/adapter').EndpointTransportState | undefined { return undefined; }
  protected executionSignal?: AbortSignal;
  protected setExecutionSignal(signal: AbortSignal): void { this.executionSignal = signal; this.transportSignal = signal; }
  /** Native protocol work runs here; Endpoint attaches the framework receipt without replacing SDK APIs. */
  protected receiveInboundCallback<T>(receive: () => T | Promise<T>): Promise<T> {
    try { return Promise.resolve(receive()); } catch (error) { return Promise.reject(error); }
  }
  protected publishEvent(name: string, payload: unknown): Promise<unknown> { this.emit(name, payload); return Promise.resolve(); }
  protected publishAccepted(name: string, payload: unknown): Promise<void> { return this.publishEvent(name, payload).then(() => undefined); }
  protected publishPlatform(name: string, event: unknown): Promise<unknown> { this.emit(name, event); return Promise.resolve(); }

  constructor(options: LineEndpointOptions) {
    super({ config: options.config, fetch: options.fetch ?? globalThis.fetch });
    this.#logger = getAdapterLogger('line', options.config.id);
    this.#options = options;
    const transportFetch = options.fetch ?? globalThis.fetch;
    this.#fetch = (url, init) => {
      this.executionSignal?.throwIfAborted();
      return transportFetch(url, { ...init, ...(this.executionSignal ? { signal: init?.signal ? AbortSignal.any([this.executionSignal, init.signal]) : this.executionSignal } : {}) });
    };
  }

  /** Used by webhook handler. */
  get isOpen(): boolean {
    return this.#open;
  }

  get config(): ResolvedLineConfig {
    return this.#options.config;
  }

  protected async connectTransport(signal?: AbortSignal): Promise<void> {
    if (signal) { this.setExecutionSignal(signal); signal.throwIfAborted(); }
    if (this.#started) return;
    this.#started = true;
    try {
      this.#routeReleases.push(...registerLineWebhookRoutes(this.#options.http, this));
      this.#logger.debug(formatCompact({
        endpoint: this.#options.config.id,
        op: 'webhook',
        path: this.#options.config.webhookPath,
      }));
    } catch (error) {
      await this.disconnectTransport();
      this.#logger.error('Failed to connect LINE endpoint:', error);
      throw error;
    }
  }

  protected openInput(): void {
    this.#open = true;
  }

  protected closeInput(): void {
    this.#open = false;
  }

  protected async disconnectTransport(): Promise<void> {
    this.#open = false;
    this.#replyTokenCache.clear();
    this.#admissions.clear();
    for (const release of this.#routeReleases.splice(0)) release();
    this.#started = false;
    this.#logger.debug(formatCompact({ op: 'disconnect' }));
  }

  protected async sendPayload({ conversation, payload, signal }: EndpointSendRequest): Promise<string> {
    try {
      const messages = formatOutboundMessages(payload);
      if (messages.length === 0) {
        throw new EndpointDeliveryError('invalid_payload', 'No valid LINE messages to send', 'not_sent');
      }
      // LINE recipient id 前缀（U/G/R）自带场景信息，原生 id 即投递地址。
      const target = conversation.id;

      const cached = this.#replyTokenCache.get(target);
      if (cached) {
        this.#replyTokenCache.delete(target);
        if (Date.now() - cached.timestamp <= REPLY_TOKEN_TTL_MS) {
          return await this.#replyMessage({ replyToken: cached.token, messages, signal });
        }
      }

      if (!isValidLineRecipientId(target)) {
        throw new EndpointDeliveryError('invalid_recipient',
          `Invalid LINE recipient ID "${target}": must start with U (user), G (group), or R (room)`, 'not_sent',
        );
      }
      return await this.#pushMessage({ to: target, messages, signal });
    } catch (error) {
      if (error instanceof EndpointDeliveryError) throw error;
      throw new EndpointDeliveryError('delivery_unconfirmed', 'Outbound request outcome is unknown', 'unknown', { cause: error });
    }
  }

  /** Test / internal: admit a parsed event when open (non-webhook path). */
  admit(event: LineEvent): void {
    if (!this.#open) return;
    void this.admitAccepted(event).catch((err) => {
      this.#logger.warn(formatCompact({ op: 'line_gateway_receive_failed', error: err instanceof Error ? err.message : String(err) }));
    });
  }

  /** Webhook acknowledgement follows actual runtime generation admission. */
  async admitAccepted(event: LineEvent): Promise<void> {
    if (!this.#open) throw new Error('LINE endpoint is closed');
    return this.receiveInboundCallback(() => this.#acceptMessage(event));
  }

  async #acceptMessage(event: LineEvent): Promise<void> {
    if (!this.#open) throw new Error('LINE endpoint is closed');
    const id = event.webhookEventId;
    if (typeof id !== 'string' || !id.trim()) return this.#dispatchAccepted(event);
    const now = Date.now();
    for (const [key, entry] of this.#admissions) if (entry.expires <= now) this.#admissions.delete(key);
    const existing = this.#admissions.get(id);
    if (existing) return existing.promise;
    // Never evict in-flight admissions: overload returns 503 and permits platform retry.
    if (this.#admissions.size >= 10_000) throw new Error('LINE admission dedup capacity exhausted');
    const entry = { promise: Promise.resolve().then(() => this.#dispatchAccepted(event)), expires: Infinity };
    this.#admissions.set(id, entry);
    try {
      await entry.promise;
      if (this.#admissions.get(id) === entry) entry.expires = Date.now() + 24 * 60 * 60 * 1000;
    } catch (error) {
      if (this.#admissions.get(id) === entry) this.#admissions.delete(id);
      throw error;
    }
  }

  protected inboundReceiptCurrent(): boolean { return this.#open && !this.executionSignal?.aborted; }

  async #dispatchAccepted(event: LineEvent): Promise<void> {
    if (!this.inboundReceiptCurrent()) throw new Error('LINE endpoint is closed');
    void this.publishPlatform(event.type || 'event', event).catch((error) => {
      this.#logger.warn(formatCompact({
        op: 'line_platform_event_failed',
        event: event.type,
        error: error instanceof Error ? error.message : String(error),
      }));
    });
    if (isLineLifecycleEvent(event)) {
      await receiveLineSideEvent(
        (name, payload) => this.publishAccepted(name, payload),
        String(this.#options.id),
        this.#options.config.id,
        event,
        this.#logger,
      );
      return;
    }
    const conversation = lineInboundConversation(String(this.#options.id), event.source);
    if ('replyToken' in event && typeof event.replyToken === 'string') {
      this.#replyTokenCache.set(conversation.id, { token: event.replyToken, timestamp: Date.now() });
    }
    await this.publishAccepted('message.receive', {
      event,
      conversation,
      message: { conversation, id: generateMessageId(event) },
      content: formatInboundContent(event),
      ...(event.source.userId ? { sender: { id: event.source.userId } } : {}),
      endpointId: this.#options.config.id,
      metadata: Object.freeze({
        eventType: event.type,
        sourceType: event.source.type,
        timestamp: event.timestamp,
        ...(isMessageEvent(event) ? { messageType: event.message.type } : {}),
      }),
    });
  }

  async #replyMessage(
    { replyToken, messages, signal }: LineReplyRequest,
  ): Promise<string> {
    const url = `${this.#options.config.apiBaseUrl}/v2/bot/message/reply`;
    const response = await this.#fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.#options.config.channelAccessToken}`,
      },
      body: JSON.stringify({ replyToken, messages }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(OUTBOUND_TIMEOUT_MS)]) : AbortSignal.timeout(OUTBOUND_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw await lineResponseError(response);
    }
    const result = await response.json() as LineApiResponse;
    return requireMessageId(result.sentMessages?.[0]?.id);
  }

  async #pushMessage(
    { to, messages, signal }: LinePushRequest,
  ): Promise<string> {
    const url = `${this.#options.config.apiBaseUrl}/v2/bot/message/push`;
    const response = await this.#fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.#options.config.channelAccessToken}`,
      },
      body: JSON.stringify({ to, messages }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(OUTBOUND_TIMEOUT_MS)]) : AbortSignal.timeout(OUTBOUND_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw await lineResponseError(response);
    }
    const result = await response.json() as LineApiResponse;
    return requireMessageId(result.sentMessages?.[0]?.id);
  }

  /**
   * group/room 成员列表：Bot API 无群列表，只能按已知 groupId/roomId 拉成员。
   * members/ids 分页（next continuation token）后逐个取 profile 归一 nickname；
   * 单个 profile 失败（用户已退群等）时回退 userId 占位，不拖垮整批。
   */
}

function createLineEndpointManagement(endpoint: LineClient): EndpointManagement {
  return Object.freeze<EndpointManagement>({
    // listGroups 不接：LINE Bot API 没有"我加入了哪些群"的接口，群 id 只能来自入站事件。
    listGroupMembers: ({ groupId, signal }: EndpointGroupRequest) => endpoint.getGroupMembers(groupId, { signal }),
  });
}

async function lineResponseError(response: Awaited<ReturnType<LineFetch>>): Promise<EndpointDeliveryError> {
  // Error responses may carry sentMessages: a failed request can have partial side effects.
  let body: { sentMessages?: unknown[] };
  try { body = await response.json() as { sentMessages?: unknown[] }; }
  catch { return new EndpointDeliveryError('delivery_unconfirmed', `LINE HTTP ${response.status}`, 'unknown'); }
  const disposition = Array.isArray(body?.sentMessages) && body.sentMessages.length > 0
    ? 'unknown' : response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 409 ? 'rejected' : 'unknown';
  return new EndpointDeliveryError(disposition === 'unknown' ? 'delivery_unconfirmed' : 'platform_rejected', `LINE HTTP ${response.status}`, disposition);
}

function requireMessageId(value: unknown): string {
  if (typeof value === 'string' && value.trim().length > 0) return value;
  throw new EndpointDeliveryError('delivery_unconfirmed', 'Platform did not return a real message ID', 'unknown');
}

export type LineClientEventMap = Record<string, LineEvent>;

export type { LineGroupMember } from './api-client.js';

interface LineMessageRequest { readonly messages: ReturnType<typeof formatOutboundMessages>; readonly signal?: AbortSignal; }
interface LineReplyRequest extends LineMessageRequest { readonly replyToken: string; }
interface LinePushRequest extends LineMessageRequest { readonly to: string; }
