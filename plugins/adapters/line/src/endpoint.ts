import { Endpoint } from 'zhin.js/adapter';
/**
 * LineEndpoint — lifecycle, outbound, admit, OpenAPI helpers for agent tools.
 */
import { type EndpointManagement, EndpointSendRequest } from 'zhin.js/adapter';
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
import { LineClient } from './client.js';

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

export class LineEndpoint extends Endpoint<LineClient> {
  readonly client: LineClient;
  readonly #logger!: ReturnType<typeof getAdapterLogger>;

  readonly #options: LineEndpointOptions;
  readonly #fetch: LineFetch;
  #routeReleases: HttpRouteRegistration[] = [];
  #replyTokenCache = new Map<string, { token: string; timestamp: number }>();
  #open = false;
  #started = false;
  readonly management: EndpointManagement = createLineEndpointManagement(this);

  constructor(options: LineEndpointOptions) {
    super();
    this.#logger = getAdapterLogger('line', options.config.id);
    this.#options = options;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.client = new LineClient(options.config, this.#fetch);
  }

  /** Used by webhook handler. */
  get isOpen(): boolean {
    return this.#open;
  }

  get config(): ResolvedLineConfig {
    return this.#options.config;
  }

  async start(): Promise<void> {
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
      await this.stop();
      this.#logger.error('Failed to connect LINE endpoint:', error);
      throw error;
    }
  }

  open(): void {
    this.#open = true;
  }

  close(): void {
    this.#open = false;
  }

  async stop(): Promise<void> {
    this.#open = false;
    this.#replyTokenCache.clear();
    for (const release of this.#routeReleases.splice(0)) release();
    this.#started = false;
    this.#logger.debug(formatCompact({ op: 'disconnect' }));
  }

  async send({ conversation, payload }: EndpointSendRequest): Promise<string> {
    const messages = formatOutboundMessages(payload);
    if (messages.length === 0) {
      throw new Error('No valid LINE messages to send');
    }
    // LINE recipient id 前缀（U/G/R）自带场景信息，原生 id 即投递地址。
    const target = conversation.id;

    const cached = this.#replyTokenCache.get(target);
    if (cached) {
      this.#replyTokenCache.delete(target);
      if (Date.now() - cached.timestamp <= REPLY_TOKEN_TTL_MS) {
        try {
          return await this.#replyMessage(cached.token, messages);
        } catch (error) {
          // replyToken 过期/失效时 LINE 返回 400，回退 push 保证消息不丢
          if ((error as { status?: number }).status !== 400) throw error;
          this.#logger.warn(formatCompact({
            op: 'line_reply_fallback_push',
            endpoint: this.#options.config.id,
            target,
          }));
        }
      }
    }

    if (!isValidLineRecipientId(target)) {
      throw new Error(
        `Invalid LINE recipient ID "${target}": must start with U (user), G (group), or R (room)`,
      );
    }
    return this.#pushMessage(target, messages);
  }

  /** Test / internal: admit a parsed event when open (non-webhook path). */
  admit(event: LineEvent): void {
    if (!this.#open) return;
    void this.emitPlatform(event.type || 'event', event).catch((error) => {
      this.#logger.warn(formatCompact({
        op: 'line_platform_event_failed',
        event: event.type,
        error: error instanceof Error ? error.message : String(error),
      }));
    });
    if (isLineLifecycleEvent(event)) {
      receiveLineSideEvent(
        (name, payload) => this.emit(name, payload),
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
    void this.emit('message.receive', {
      conversation,
      message: { conversation, id: generateMessageId(event) },
      content: formatInboundContent(event),
      sender: { id: event.source.userId || conversation.id },
      endpointId: this.#options.config.id,
      metadata: Object.freeze({
        eventType: event.type,
        sourceType: event.source.type,
        timestamp: event.timestamp,
        ...(isMessageEvent(event) ? { messageType: event.message.type } : {}),
      }),
    }).catch((err) => {
      this.#logger.warn(formatCompact({
        op: 'line_gateway_receive_failed',
        target: `${conversation.kind}:${conversation.id}`,
        error: err instanceof Error ? err.message : String(err),
      }));
    });
  }

  async #replyMessage(
    replyToken: string,
    messages: ReturnType<typeof formatOutboundMessages>,
  ): Promise<string> {
    const url = `${this.#options.config.apiBaseUrl}/v2/bot/message/reply`;
    const response = await this.#fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.#options.config.channelAccessToken}`,
      },
      body: JSON.stringify({ replyToken, messages }),
      signal: AbortSignal.timeout(OUTBOUND_TIMEOUT_MS),
    });
    if (!response.ok) {
      const errorText = await response.text();
      const error = new Error(`LINE Reply API error ${response.status}: ${errorText}`) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }
    const result = await response.json() as LineApiResponse;
    return result.sentMessages?.[0]?.id || `reply-${Date.now()}`;
  }

  async #pushMessage(
    to: string,
    messages: ReturnType<typeof formatOutboundMessages>,
  ): Promise<string> {
    const url = `${this.#options.config.apiBaseUrl}/v2/bot/message/push`;
    const response = await this.#fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.#options.config.channelAccessToken}`,
      },
      body: JSON.stringify({ to, messages }),
      signal: AbortSignal.timeout(OUTBOUND_TIMEOUT_MS),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LINE Push API error ${response.status}: ${errorText}`);
    }
    const result = await response.json() as LineApiResponse;
    return result.sentMessages?.[0]?.id || `push-${Date.now()}`;
  }

  /**
   * group/room 成员列表：Bot API 无群列表，只能按已知 groupId/roomId 拉成员。
   * members/ids 分页（next continuation token）后逐个取 profile 归一 nickname；
   * 单个 profile 失败（用户已退群等）时回退 userId 占位，不拖垮整批。
   */
}

function createLineEndpointManagement(endpoint: LineEndpoint): EndpointManagement {
  return Object.freeze<EndpointManagement>({
    // listGroups 不接：LINE Bot API 没有"我加入了哪些群"的接口，群 id 只能来自入站事件。
    listGroupMembers: (groupId) => endpoint.client.getGroupMembers(groupId),
  });
}
