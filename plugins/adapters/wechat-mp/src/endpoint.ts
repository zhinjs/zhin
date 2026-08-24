import { Endpoint } from 'zhin.js/adapter';
/**
 * WeChatMpEndpoint — lifecycle, outbound, admit, access token refresh.
 */
import axios from 'axios';
import type { EndpointManagement, EndpointSendRequest } from 'zhin.js/adapter';
import type { HttpHost, HttpRouteRegistration } from '@zhin.js/host-http';
import { formatCompact, getAdapterLogger } from '@zhin.js/logger';
import type { CapabilityId } from 'zhin.js';
import {
  extractOutboundText,
  formatCustomerServiceBody,
  formatInboundContent,
  formatInboundId,
  wechatMpInboundConversation,
  type ResolvedWeChatMpConfig,
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
import { receiveWeChatMpSideEvent } from './side-event-dispatch.js';
import { WeChatMpClient, type WeChatMpFetch } from './client.js';

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

export interface WeChatMpEndpointOptions {
  readonly id: CapabilityId;
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

export class WeChatMpEndpoint extends Endpoint<WeChatMpClient> {
  readonly client: WeChatMpClient;
  readonly #logger!: ReturnType<typeof getAdapterLogger>;

  readonly #options: WeChatMpEndpointOptions;
  readonly #fetch: WeChatMpFetch;
  #routeReleases: HttpRouteRegistration[] = [];
  #tokenRefreshTimer?: ReturnType<typeof setInterval>;
  /** MsgId → 首次回复 XML（微信 5s 重推去重，有界 LRU）。 */
  readonly #replyCache = new Map<string, string>();
  static readonly #REPLY_CACHE_LIMIT = 1000;
  #open = false;
  #started = false;
  readonly management: EndpointManagement = createWeChatMpEndpointManagement(() => this.client);

  constructor(options: WeChatMpEndpointOptions) {
    super();
    this.#logger = getAdapterLogger('wechat-mp', options.config.id);
    this.#options = options;
    this.#fetch = options.fetch ?? defaultFetch;
    this.client = new WeChatMpClient(options.config, this.#fetch);
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
      await this.client.refreshAccessToken();
      this.#routeReleases.push(...registerWeChatMpWebhookRoutes(this.#options.http, this));
      this.#startTokenRefreshTimer();
      this.#logger.debug(formatCompact({
        endpoint: this.#options.config.id,
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
      endpoint: this.#options.config.id,
      target: `${conversation.kind}:${conversation.id}`,
    }));
    return `passive_skipped_${Date.now()}`;
  }

  /** Test / internal: admit a parsed message when open (non-webhook path). */
  admit(msg: WeChatMessage): void | Promise<unknown> {
    if (!this.#open) return;
    void this.emitPlatform(msg.Event ? `${msg.MsgType}.${msg.Event}` : msg.MsgType, msg).catch((error) => {
      this.#logger.warn(formatCompact({
        op: 'wechat_mp_platform_event_failed',
        error: error instanceof Error ? error.message : String(error),
      }));
    });
    if (receiveWeChatMpSideEvent(
      (name, payload) => this.emit(name, payload),
      this.#options.config.id,
      msg,
      this.#logger,
    )) {
      return undefined;
    }
    const conversation = wechatMpInboundConversation(String(this.#options.id), msg);
    return this.emit('message.receive', {
      conversation,
      message: { conversation, id: formatInboundId(msg) },
      content: formatInboundContent(msg),
      sender: { id: msg.FromUserName },
      endpointId: this.#options.config.id,
      metadata: Object.freeze({
        msgType: msg.MsgType,
        event: msg.Event,
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
    const materialized = await this.#materializeOutboundMedia(payload);
    const messageData = formatCustomerServiceBody(target, materialized);
    const result = await this.client.sendCustomerService(messageData);
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
          endpoint: this.#options.config.id,
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
          endpoint: this.#options.config.id,
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
          endpoint: this.#options.config.id,
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
    return this.client.uploadMedia(type, form);
  }

  #startTokenRefreshTimer(): void {
    this.#tokenRefreshTimer = setInterval(() => {
      if (this.client.tokenExpired) {
        void this.client.refreshAccessToken().catch((error) => {
          this.#logger.error('Failed to refresh access token in timer:', error);
        });
      }
    }, 3_600_000);
  }
}

function createWeChatMpEndpointManagement(
  requireClient: () => WeChatMpClient,
): EndpointManagement {
  return Object.freeze<EndpointManagement>({
    // 公众号无群/频道概念；关注者即"好友"（nickname 为 openid 占位，见 getFollowers）。
    listFriends: async () => (await requireClient().getFollowerIds()).map((openid) => ({
      user_id: openid,
      nickname: openid,
      remark: '',
    })),
  });
}
