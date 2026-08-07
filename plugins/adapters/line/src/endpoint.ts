/**
 * LineEndpoint — lifecycle, outbound, admit, OpenAPI helpers for agent tools.
 */
import type { EndpointInstance, EndpointManagement, EndpointSendRequest } from '@zhin.js/adapter';
import type { MessageGateway } from '@zhin.js/core/runtime';
import type { HttpHost, HttpRouteRegistration } from '@zhin.js/host-http';
import { formatCompact, getAdapterLogger } from '@zhin.js/logger';
import type { CapabilityId } from '@zhin.js/plugin-runtime';
import { registerLineAgentEndpoint } from './line-agent-deps.js';
import {
  formatInboundContent,
  formatOutboundMessages,
  generateMessageId,
  isMessageEvent,
  isValidLineRecipientId,
  lineInboundConversation,
  type LineApiResponse,
  type LineEvent,
  type ResolvedLineConfig,
} from './protocol.js';
import { registerLineWebhookRoutes } from './webhook.js';

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
  readonly gateway: MessageGateway;
  readonly http: HttpHost;
  readonly config: ResolvedLineConfig;
  readonly fetch?: LineFetch;
}

export class LineEndpoint implements EndpointInstance {
  readonly #logger!: ReturnType<typeof getAdapterLogger>;

  readonly #options: LineEndpointOptions;
  readonly #fetch: LineFetch;
  #routeReleases: HttpRouteRegistration[] = [];
  #replyTokenCache = new Map<string, { token: string; timestamp: number }>();
  #open = false;
  #started = false;
  #unregisterAgent?: () => void;
  readonly management: EndpointManagement = createLineEndpointManagement(this);

  constructor(options: LineEndpointOptions) {
    this.#logger = getAdapterLogger('line', options.config.name);
    this.#options = options;
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  /** Used by webhook handler. */
  get isOpen(): boolean {
    return this.#open;
  }

  get config(): ResolvedLineConfig {
    return this.#options.config;
  }

  getApiConfig(): { accessToken: string; apiBaseUrl: string } {
    return {
      accessToken: this.#options.config.channelAccessToken,
      apiBaseUrl: this.#options.config.apiBaseUrl,
    };
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    try {
      this.#unregisterAgent = registerLineAgentEndpoint(this.#options.config.name, this);
      this.#routeReleases.push(...registerLineWebhookRoutes(this.#options.http, this));
      this.#logger.debug(formatCompact({
        endpoint: this.#options.config.name,
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
    this.#unregisterAgent?.();
    this.#unregisterAgent = undefined;
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
            endpoint: this.#options.config.name,
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
    const conversation = lineInboundConversation(String(this.#options.id), event.source);
    if ('replyToken' in event && typeof event.replyToken === 'string') {
      this.#replyTokenCache.set(conversation.id, { token: event.replyToken, timestamp: Date.now() });
    }
    void this.#options.gateway.receive({
      conversation,
      message: { conversation, id: generateMessageId(event) },
      content: formatInboundContent(event),
      sender: event.source.userId || conversation.id,
      metadata: Object.freeze({
        eventType: event.type,
        sourceType: event.source.type,
        endpoint: this.#options.config.name,
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
  async getGroupMembers(groupId: string): Promise<LineGroupMember[]> {
    const kind = groupId.startsWith('R') ? 'room' : 'group';
    const memberIds: string[] = [];
    let start: string | undefined;
    do {
      const query = start ? `?start=${encodeURIComponent(start)}` : '';
      const data = await this.#get(
        `${this.#options.config.apiBaseUrl}/v2/bot/${kind}/${encodeURIComponent(groupId)}/members/ids${query}`,
      ) as { memberIds?: string[]; next?: string };
      for (const id of data.memberIds ?? []) {
        if (typeof id === 'string' && id) memberIds.push(id);
      }
      start = data.next || undefined;
    } while (start);

    return Promise.all(memberIds.map(async (userId) => {
      try {
        const profile = await this.#get(
          `${this.#options.config.apiBaseUrl}/v2/bot/${kind}/${encodeURIComponent(groupId)}/member/${encodeURIComponent(userId)}`,
        ) as { displayName?: string };
        return { user_id: userId, nickname: String(profile.displayName ?? userId) };
      } catch {
        return { user_id: userId, nickname: userId };
      }
    }));
  }

  async #get(url: string): Promise<unknown> {
    const response = await this.#fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${this.#options.config.channelAccessToken}` },
      signal: AbortSignal.timeout(OUTBOUND_TIMEOUT_MS),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LINE API error ${response.status}: ${errorText}`);
    }
    return response.json();
  }
}

export interface LineGroupMember {
  readonly user_id: string;
  readonly nickname: string;
}

function createLineEndpointManagement(endpoint: LineEndpoint): EndpointManagement {
  return Object.freeze<EndpointManagement>({
    // listGroups 不接：LINE Bot API 没有"我加入了哪些群"的接口，群 id 只能来自入站事件。
    listGroupMembers: (groupId) => endpoint.getGroupMembers(groupId),
  });
}
