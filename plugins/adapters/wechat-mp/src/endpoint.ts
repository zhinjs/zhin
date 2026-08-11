/**
 * WeChatMpEndpoint — lifecycle, outbound, admit, access token refresh.
 */
import axios from 'axios';
import type { EndpointFriend, EndpointInstance, EndpointManagement, EndpointSendRequest } from '@zhin.js/adapter';
import type { MessageGateway } from '@zhin.js/core/runtime';
import type { HttpHost, HttpRouteRegistration } from '@zhin.js/host-http';
import { formatCompact, getAdapterLogger } from '@zhin.js/logger';
import type { CapabilityId } from '@zhin.js/plugin-runtime';
import {
  extractOutboundText,
  formatCustomerServiceBody,
  formatInboundContent,
  formatInboundId,
  wechatMpInboundConversation,
  type ResolvedWeChatMpConfig,
  type TokenResponse,
  type WeChatAPIResponse,
  type WeChatMessage,
} from './protocol.js';
import {
  buildMediaUploadForm,
  readOutboundMedia,
  resolveMediaBinary,
  type WeChatMediaUploadResult,
} from './media-upload.js';
import {
  getPassiveReplyCapture,
  recordPassiveReplyText,
} from './passive-reply.js';
import { registerWeChatMpWebhookRoutes } from './webhook.js';

/** token 失效类错误码：40001/40014 invalid access_token、42001 access_token expired。 */
const TOKEN_INVALID_ERRCODES = new Set([40001, 40014, 42001]);

/**
 * canonical 媒体段类型 → 微信 /cgi-bin/media/upload 的 type。
 * 客服消息无 file 投递面，file 段不可投递。
 */
const WECHAT_UPLOAD_TYPE: Readonly<Record<string, 'image' | 'voice' | 'video'>> = {
  image: 'image',
  audio: 'voice',
  voice: 'voice',
  video: 'video',
};

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
  readonly #logger!: ReturnType<typeof getAdapterLogger>;

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
    this.#logger = getAdapterLogger('wechat-mp', options.config.name);
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
      this.#logger.debug(formatCompact({
        endpoint: this.#options.config.name,
        op: 'webhook',
        path: this.#options.config.path,
      }));
    } catch (error) {
      await this.stop();
      this.#logger.error('Failed to connect WeChat MP bot:', error);
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
    this.#logger.debug(formatCompact({ op: 'disconnect' }));
  }

  async send({ conversation, payload }: EndpointSendRequest): Promise<string> {
    if (getPassiveReplyCapture()) {
      const text = extractOutboundText(payload);
      recordPassiveReplyText(text);
      return `passive_${Date.now()}`;
    }

    if (this.#options.config.replyMode === 'customer_service') {
      return this.#sendCustomerService(conversation.id, payload);
    }

    this.#logger.warn(formatCompact({
      op: 'send',
      skip: 'passive_outside_webhook',
      endpoint: this.#options.config.name,
      target: `${conversation.kind}:${conversation.id}`,
    }));
    return `passive_skipped_${Date.now()}`;
  }

  /** Test / internal: admit a parsed message when open (non-webhook path). */
  admit(msg: WeChatMessage): void {
    if (!this.#open) return;
    const conversation = wechatMpInboundConversation(String(this.#options.id), msg);
    void this.#options.gateway.receive({
      conversation,
      message: { conversation, id: formatInboundId(msg) },
      content: formatInboundContent(msg),
      sender: { id: msg.FromUserName },
      metadata: Object.freeze({
        msgType: msg.MsgType,
        event: msg.Event,
        endpoint: this.#options.config.name,
        toUserName: msg.ToUserName,
      }),
    }).catch((err) => {
      this.#logger.warn(formatCompact({
        op: 'wechat_mp_gateway_receive_failed',
        target: `${conversation.kind}:${conversation.id}`,
        error: err instanceof Error ? err.message : String(err),
      }));
    });
  }

  async #sendCustomerService(target: string, payload: unknown): Promise<string> {
    // 发送前检查过期（不只判 null）：过期 token 直接刷新，不白跑一次 40001。
    if (!this.#accessToken || Date.now() >= this.#tokenExpireTime) {
      await this.#refreshAccessToken();
    }
    const materialized = await this.#materializeOutboundMedia(payload);
    const messageData = formatCustomerServiceBody(target, materialized);
    let result = await this.#postCustomerService(messageData);
    if (result.errcode && TOKEN_INVALID_ERRCODES.has(Number(result.errcode))) {
      // 对端提前作废 token（多端共用等）：刷新后重试一次。
      this.#logger.warn(formatCompact({
        op: 'wechat_mp_token_invalid_retry',
        errcode: result.errcode,
      }));
      await this.#refreshAccessToken();
      result = await this.#postCustomerService(messageData);
    }
    if (result.errcode && result.errcode !== 0) {
      throw new Error(`WeChat API error: ${result.errcode} - ${result.errmsg}`);
    }
    this.#logger.debug(formatCompact({ op: 'wechat_mp_send', target, messageId: result.msgid }));
    return result.msgid?.toString() || `cs_${Date.now()}`;
  }

  /**
   * 客服消息媒体段只接受 media_id：canonical MediaRef 是唯一来源。
   * - kind=file（平台不透明引用，即既有 media_id）→ 直接透传；
   * - kind=base64 / path / url → 经 /cgi-bin/media/upload 物化；
   * - 无 MediaRef / 类型不可投递（file 段）→ warn + 丢弃；
   * - 上传失败降级为文本（alt 优先），不阻断发送。
   */
  async #materializeOutboundMedia(payload: unknown): Promise<unknown> {
    if (!Array.isArray(payload)) return payload;
    const materialized = await Promise.all(payload.map(async (item) => {
      if (typeof item === 'string' || !item || typeof item !== 'object') return item;
      const seg = item as { type?: unknown; data?: Record<string, unknown> };
      if (typeof seg.type !== 'string') return item;
      const data = seg.data ?? {};
      const uploadType = WECHAT_UPLOAD_TYPE[seg.type];
      const isMediaSegment = uploadType != null || seg.type === 'file';
      if (!isMediaSegment) return item;
      const media = readOutboundMedia(data);
      if (!media) {
        // 已物化（mediaId/media_id）的段透传；其余无 canonical 媒体引用，丢弃留痕
        if (typeof data.mediaId === 'string' && data.mediaId) return item;
        if (typeof data.media_id === 'string' && data.media_id) return item;
        this.#logger.warn(formatCompact({
          op: 'wechat_mp_outbound_media_dropped',
          endpoint: this.#options.config.name,
          type: seg.type,
          reason: 'missing_media_ref',
        }));
        return null;
      }
      if (media.kind === 'file') {
        // 平台不透明引用：value 即 media_id，直接透传不上传
        return { type: seg.type, data: { mediaId: media.value } };
      }
      if (!uploadType) {
        this.#logger.warn(formatCompact({
          op: 'wechat_mp_outbound_media_dropped',
          endpoint: this.#options.config.name,
          type: seg.type,
          reason: 'unsupported_segment_type',
        }));
        return null;
      }
      try {
        const mediaId = await this.#uploadMedia(uploadType, media);
        return { type: seg.type, data: { mediaId } };
      } catch (error) {
        this.#logger.warn(formatCompact({
          op: 'wechat_mp_media_upload_failed',
          endpoint: this.#options.config.name,
          error: error instanceof Error ? error.message : String(error),
        }));
        const alt = typeof data.alt === 'string' && data.alt ? data.alt : `[${seg.type}]`;
        return { type: 'text', data: { text: alt } };
      }
    }));
    return materialized.filter((item) => item != null);
  }

  /** POST /cgi-bin/media/upload（临时素材，3 天有效），返回 media_id。 */
  async #uploadMedia(
    type: 'image' | 'voice' | 'video',
    media: Parameters<typeof resolveMediaBinary>[0],
  ): Promise<string> {
    const binary = await resolveMediaBinary(media);
    const form = buildMediaUploadForm(binary);
    const url = `https://api.weixin.qq.com/cgi-bin/media/upload?access_token=${this.#accessToken}&type=${type}`;
    const response = await this.#fetch(url, { method: 'POST', body: form });
    const data = response.data as WeChatMediaUploadResult;
    if (data.media_id) return data.media_id;
    throw new Error(`WeChat media upload failed: ${data.errcode ?? 'unknown'} ${data.errmsg ?? ''}`.trim());
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
      this.#logger.debug(formatCompact({ op: 'token_refresh' }));
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
          this.#logger.error('Failed to refresh access token in timer:', error);
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
