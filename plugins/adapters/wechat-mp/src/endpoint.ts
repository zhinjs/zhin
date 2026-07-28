/**
 * WeChatMpEndpoint — lifecycle, outbound, admit, access token refresh.
 */
import axios from 'axios';
import type { EndpointFriend, EndpointInstance, EndpointManagement } from '@zhin.js/adapter';
import type { MessageGateway } from '@zhin.js/core/runtime';
import type { HttpHost, HttpRouteRegistration } from '@zhin.js/host-http';
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { CapabilityId } from '@zhin.js/plugin-runtime';
import {
  extractOutboundText,
  formatCustomerServiceBody,
  formatInboundContent,
  formatInboundId,
  type ResolvedWeChatMpConfig,
  type TokenResponse,
  type WeChatAPIResponse,
  type WeChatMessage,
} from './protocol.js';
import {
  getPassiveReplyCapture,
  recordPassiveReplyText,
} from './passive-reply.js';
import { registerWeChatMpWebhookRoutes } from './webhook.js';

const logger = getLogger('wechat-mp');

/** token 失效类错误码：40001/40014 invalid access_token、42001 access_token expired。 */
const TOKEN_INVALID_ERRCODES = new Set([40001, 40014, 42001]);

export type WeChatMpFetch = (
  url: string,
  init?: { readonly method?: string; readonly body?: unknown; readonly headers?: Record<string, string> },
) => Promise<{ readonly data: unknown }>;

export interface WeChatMpEndpointOptions {
  readonly id: CapabilityId;
  readonly gateway: MessageGateway;
  readonly http: HttpHost;
  readonly config: ResolvedWeChatMpConfig;
  readonly fetch?: WeChatMpFetch;
}

function defaultFetch(
  url: string,
  init?: { readonly method?: string; readonly body?: unknown; readonly headers?: Record<string, string> },
): Promise<{ data: unknown }> {
  return axios({
    url,
    method: (init?.method ?? 'GET') as 'GET' | 'POST',
    data: init?.body,
    headers: init?.headers,
  }).then((response) => ({ data: response.data }));
}

export class WeChatMpEndpoint implements EndpointInstance {
  readonly #options: WeChatMpEndpointOptions;
  readonly #fetch: WeChatMpFetch;
  #routeReleases: HttpRouteRegistration[] = [];
  #accessToken: string | null = null;
  #tokenExpireTime = 0;
  #tokenRefreshTimer?: ReturnType<typeof setInterval>;
  /** MsgId → 首次回复 XML（微信 5s 重推去重，有界 LRU）。 */
  readonly #replyCache = new Map<string, string>();
  static readonly #REPLY_CACHE_LIMIT = 1000;
  #open = false;
  #started = false;
  readonly management: EndpointManagement = createWeChatMpEndpointManagement(this);

  constructor(options: WeChatMpEndpointOptions) {
    this.#options = options;
    this.#fetch = options.fetch ?? defaultFetch;
  }

  /** Used by webhook handler. */
  get isOpen(): boolean {
    return this.#open;
  }

  get config(): ResolvedWeChatMpConfig {
    return this.#options.config;
  }

  get id(): CapabilityId {
    return this.#options.id;
  }

  get gateway(): MessageGateway {
    return this.#options.gateway;
  }

  /** 微信 5s 重推去重：见过该 MsgId 时返回首次回复 XML（含空串=success）。 */
  getCachedReply(msgId: string): string | undefined {
    return this.#replyCache.get(msgId);
  }

  cacheReply(msgId: string, replyXML: string): void {
    if (this.#replyCache.has(msgId)) this.#replyCache.delete(msgId);
    this.#replyCache.set(msgId, replyXML);
    while (this.#replyCache.size > WeChatMpEndpoint.#REPLY_CACHE_LIMIT) {
      const oldest = this.#replyCache.keys().next().value;
      if (oldest === undefined) break;
      this.#replyCache.delete(oldest);
    }
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    try {
      await this.#refreshAccessToken();
      this.#routeReleases.push(...registerWeChatMpWebhookRoutes(this.#options.http, this));
      this.#startTokenRefreshTimer();
      logger.debug(formatCompact({
        endpoint: this.#options.config.name,
        op: 'webhook',
        path: this.#options.config.path,
      }));
    } catch (error) {
      await this.stop();
      logger.error('Failed to connect WeChat MP bot:', error);
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
    if (this.#tokenRefreshTimer) {
      clearInterval(this.#tokenRefreshTimer);
      this.#tokenRefreshTimer = undefined;
    }
    for (const release of this.#routeReleases.splice(0)) release();
    this.#started = false;
    logger.debug(formatCompact({ op: 'disconnect', endpoint: this.#options.config.name }));
  }

  async send({ target, payload }: { readonly target: string; readonly payload: unknown }): Promise<string> {
    if (getPassiveReplyCapture()) {
      const text = extractOutboundText(payload);
      recordPassiveReplyText(text);
      return `passive_${Date.now()}`;
    }

    if (this.#options.config.replyMode === 'customer_service') {
      return this.#sendCustomerService(target, payload);
    }

    logger.warn(formatCompact({
      op: 'send',
      skip: 'passive_outside_webhook',
      endpoint: this.#options.config.name,
      target,
    }));
    return `passive_skipped_${Date.now()}`;
  }

  /** Test / internal: admit a parsed message when open (non-webhook path). */
  admit(msg: WeChatMessage): void {
    if (!this.#open) return;
    void this.#options.gateway.receive({
      adapter: this.#options.id,
      target: msg.FromUserName,
      content: formatInboundContent(msg),
      sender: msg.FromUserName,
      id: formatInboundId(msg),
      metadata: Object.freeze({
        msgType: msg.MsgType,
        event: msg.Event,
        endpoint: this.#options.config.name,
        toUserName: msg.ToUserName,
      }),
    }).catch((err) => {
      logger.warn(formatCompact({
        op: 'wechat_mp_gateway_receive_failed',
        target: msg.FromUserName,
        error: err instanceof Error ? err.message : String(err),
      }));
    });
  }

  async #sendCustomerService(target: string, payload: unknown): Promise<string> {
    // 发送前检查过期（不只判 null）：过期 token 直接刷新，不白跑一次 40001。
    if (!this.#accessToken || Date.now() >= this.#tokenExpireTime) {
      await this.#refreshAccessToken();
    }
    const messageData = formatCustomerServiceBody(target, payload);
    let result = await this.#postCustomerService(messageData);
    if (result.errcode && TOKEN_INVALID_ERRCODES.has(Number(result.errcode))) {
      // 对端提前作废 token（多端共用等）：刷新后重试一次。
      logger.warn(formatCompact({
        op: 'wechat_mp_token_invalid_retry',
        errcode: result.errcode,
      }));
      await this.#refreshAccessToken();
      result = await this.#postCustomerService(messageData);
    }
    if (result.errcode && result.errcode !== 0) {
      throw new Error(`WeChat API error: ${result.errcode} - ${result.errmsg}`);
    }
    logger.debug(formatCompact({ op: 'wechat_mp_send', target, messageId: result.msgid }));
    return result.msgid?.toString() || `cs_${Date.now()}`;
  }

  async #postCustomerService(messageData: unknown): Promise<WeChatAPIResponse> {
    const url = `https://api.weixin.qq.com/cgi-bin/message/custom/send?access_token=${this.#accessToken}`;
    const response = await this.#fetch(url, { method: 'POST', body: messageData });
    return response.data as WeChatAPIResponse;
  }

  /**
   * 关注者列表（GET /cgi-bin/user/get，按 next_openid 分页，每页最多 10000）。
   * 该接口只回 openid 不回昵称；昵称需逐个调 user/info（成本高且依赖用户授权），
   * 这里 nickname 用 openid 占位，由 Console 侧自行理解。
   */
  async getFollowers(): Promise<readonly EndpointFriend[]> {
    if (!this.#accessToken || Date.now() >= this.#tokenExpireTime) {
      await this.#refreshAccessToken();
    }
    const friends: EndpointFriend[] = [];
    let nextOpenid = '';
    do {
      const url = `https://api.weixin.qq.com/cgi-bin/user/get?access_token=${this.#accessToken}&next_openid=${encodeURIComponent(nextOpenid)}`;
      const response = await this.#fetch(url);
      const data = response.data as WeChatAPIResponse & {
        count?: number;
        data?: { openid?: string[] };
        next_openid?: string;
      };
      if (data.errcode && data.errcode !== 0) {
        throw new Error(`WeChat API error: ${data.errcode} - ${data.errmsg}`);
      }
      for (const openid of data.data?.openid ?? []) {
        if (typeof openid === 'string' && openid) {
          friends.push({ user_id: openid, nickname: openid, remark: '' });
        }
      }
      const fetched = Number(data.count ?? 0);
      nextOpenid = typeof data.next_openid === 'string' ? data.next_openid : '';
      // 满页（10000）才可能有下一页；不足一页即到底，避免依赖 next_openid 回显语义。
      if (fetched < 10_000) break;
    } while (nextOpenid);
    return friends;
  }

  async #refreshAccessToken(): Promise<void> {
    const { appId, appSecret } = this.#options.config;
    const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appId}&secret=${appSecret}`;
    const response = await this.#fetch(url);
    const data = response.data as TokenResponse & WeChatAPIResponse;
    if (data.access_token) {
      this.#accessToken = data.access_token;
      this.#tokenExpireTime = Date.now() + (data.expires_in - 300) * 1000;
      logger.debug(formatCompact({ op: 'token_refresh' }));
      return;
    }
    throw new Error(
      data.errmsg
        ? `Failed to get access token: ${data.errcode} ${data.errmsg}`
        : 'Failed to get access token',
    );
  }

  #startTokenRefreshTimer(): void {
    this.#tokenRefreshTimer = setInterval(() => {
      if (Date.now() >= this.#tokenExpireTime) {
        void this.#refreshAccessToken().catch((error) => {
          logger.error('Failed to refresh access token in timer:', error);
        });
      }
    }, 3_600_000);
  }
}

function createWeChatMpEndpointManagement(endpoint: WeChatMpEndpoint): EndpointManagement {
  return Object.freeze<EndpointManagement>({
    // 公众号无群/频道概念；关注者即"好友"（nickname 为 openid 占位，见 getFollowers）。
    listFriends: () => endpoint.getFollowers(),
  });
}
