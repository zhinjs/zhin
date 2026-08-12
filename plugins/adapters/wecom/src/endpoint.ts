/**
 * WecomEndpoint — lifecycle, outbound send, inbound admit, OpenAPI helpers for agent tools.
 */
import type { EndpointInstance, EndpointSendRequest } from '@zhin.js/adapter';
import type { MessageGateway } from '@zhin.js/core/runtime';
import type { HttpHost, HttpRouteRegistration } from '@zhin.js/host-http';
import { formatCompact, getAdapterLogger } from '@zhin.js/logger';
import type { CapabilityId } from '@zhin.js/plugin-runtime';
import { registerWecomAgentEndpoint } from './wecom-agent-deps.js';
import {
  buildMediaUploadForm,
  readOutboundImageMedia,
  resolveMediaBinary,
  type WecomMediaUploadResult,
} from './media-upload.js';
import {
  buildSendRequestBody,
  formatInboundContent,
  formatOutboundBody,
  resolveChatType,
  wecomInboundConversation,
  type AccessToken,
  type ResolvedWecomConfig,
  type WecomApiResponse,
  type WecomMessage,
} from './protocol.js';
import { registerWecomWebhookRoutes } from './webhook.js';

export type WecomFetch = (
  url: string,
  init?: {
    readonly method?: string;
    readonly headers?: Record<string, string>;
    readonly body?: string | FormData;
  },
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}>;

export interface WecomEndpointOptions {
  readonly id: CapabilityId;
  readonly gateway: MessageGateway;
  readonly http: HttpHost;
  readonly config: ResolvedWecomConfig;
  readonly fetch?: WecomFetch;
}

/**
 * 企业微信服务端 API 无 bot 群列表/群成员列表接口（客户群接口属「客户联系」
 * 独立授权域，非 bot 社交面），好友/频道概念亦不存在；
 * 因此本 endpoint 不暴露 EndpointManagement（Console 社交面 RPC 对该平台保持未接线）。
 */
export class WecomEndpoint implements EndpointInstance {
  readonly #logger!: ReturnType<typeof getAdapterLogger>;

  readonly #options: WecomEndpointOptions;
  readonly #fetch: WecomFetch;
  #routeReleases: HttpRouteRegistration[] = [];
  #accessToken: AccessToken = { access_token: '', expires_in: 0, timestamp: 0 };
  #refreshPromise: Promise<string> | null = null;
  #open = false;
  #started = false;
  #unregisterAgent?: () => void;

  constructor(options: WecomEndpointOptions) {
    this.#logger = getAdapterLogger('wecom', options.config.id);
    this.#options = options;
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  /** Used by webhook handler. */
  get isOpen(): boolean {
    return this.#open;
  }

  get config(): ResolvedWecomConfig {
    return this.#options.config;
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    try {
      await this.#refreshAccessToken();
      this.#unregisterAgent = registerWecomAgentEndpoint(this.#options.config.id, this);
      this.#routeReleases.push(...registerWecomWebhookRoutes(this.#options.http, this));
      this.#logger.debug(formatCompact({
        endpoint: this.#options.config.id,
        op: 'webhook',
        path: this.#options.config.webhookPath,
      }));
    } catch (error) {
      await this.stop();
      this.#logger.error('Failed to connect WeCom endpoint:', error);
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
    for (const release of this.#routeReleases.splice(0)) release();
    this.#unregisterAgent?.();
    this.#unregisterAgent = undefined;
    this.#started = false;
    this.#logger.debug(formatCompact({ op: 'disconnect' }));
  }

  async send({ conversation, payload }: EndpointSendRequest): Promise<string> {
    const materialized = await this.#materializeOutboundMedia(payload);
    const content = formatOutboundBody(materialized);
    const body = buildSendRequestBody(
      conversation.id,
      content,
      // Legacy field: historically written into agentid (preserved for cutover).
      this.#options.config.agentSecret,
    );
    const data = await this.#request('/cgi-bin/message/send', {
      method: 'POST',
      body,
    });
    if (data.errcode !== 0) {
      throw new Error(`Failed to send message: ${data.errmsg} (${data.errcode})`);
    }
    this.#logger.debug(formatCompact({ op: 'send', to: `${conversation.kind}:${conversation.id}`,
    }));
    return (data.msgid as string) || `${Date.now()}`;
  }

  async recallMessage(messageId: string): Promise<void> {
    if (!messageId) return;
    await this.#request('/cgi-bin/message/recall', {
      method: 'POST',
      body: { msgid: messageId },
    });
  }

  /**
   * message/send 的 image 段只接受 media_id：canonical MediaRef 按 kind 投递——
   * file（平台不透明引用）直用为 media_id；base64/本地路径/URL 先经
   * /cgi-bin/media/upload 物化；上传失败降级为文本（alt 优先），不阻断发送。
   * 无 canonical MediaRef 的媒体段 warn + 丢弃。
   */
  async #materializeOutboundMedia(payload: unknown): Promise<unknown> {
    if (!Array.isArray(payload)) return payload;
    const items = await Promise.all(payload.map(async (item) => {
      if (typeof item === 'string' || !item || typeof item !== 'object') return item;
      const seg = item as { type?: unknown; data?: Record<string, unknown> };
      if (seg.type !== 'image') return item;
      const data = seg.data ?? {};
      const media = readOutboundImageMedia(data);
      if (!media) {
        this.#logger.warn(formatCompact({
          op: 'wecom_outbound_media_dropped',
          endpoint: this.#options.config.id,
          type: 'image',
          reason: 'missing_media_ref',
        }));
        return null;
      }
      if (media.kind === 'file') {
        return { type: 'image', data: { media_id: media.value } };
      }
      try {
        const mediaId = await this.#uploadMedia('image', media);
        return { type: 'image', data: { media_id: mediaId } };
      } catch (error) {
        this.#logger.warn(formatCompact({
          op: 'wecom_media_upload_failed',
          endpoint: this.#options.config.id,
          error: error instanceof Error ? error.message : String(error),
        }));
        const alt = typeof data.alt === 'string' && data.alt ? data.alt : '[image]';
        return { type: 'text', data: { text: alt } };
      }
    }));
    return items.filter((item) => item !== null);
  }

  /** POST /cgi-bin/media/upload（临时素材，3 天有效），返回 media_id。 */
  async #uploadMedia(type: 'image', media: Parameters<typeof resolveMediaBinary>[0]): Promise<string> {
    await this.#ensureAccessToken();
    const binary = await resolveMediaBinary(media);
    const form = buildMediaUploadForm(binary);
    const url = `${this.#options.config.apiBaseUrl}/cgi-bin/media/upload?access_token=${this.#accessToken.access_token}&type=${type}`;
    const response = await this.#fetch(url, { method: 'POST', body: form });
    const data = await response.json() as WecomMediaUploadResult;
    if (data.errcode === 0 && data.media_id) return data.media_id;
    throw new Error(`WeCom media upload failed: ${data.errmsg ?? 'unknown'} (${data.errcode ?? '?'})`);
  }

  /** Test / internal: admit a parsed message when open (non-webhook path). */
  admit(msg: WecomMessage): void {
    if (!this.#open) return;
    const chatType = resolveChatType(msg.FromUserName);
    const conversation = wecomInboundConversation(String(this.#options.id), msg);
    void this.#options.gateway.receive({
      conversation,
      message: { conversation, id: msg.MsgId || `${msg.CreateTime}` },
      content: formatInboundContent(msg),
      sender: { id: msg.FromUserName },
      endpointId: this.#options.config.id,
      metadata: Object.freeze({
        msgType: msg.MsgType,
        event: msg.Event,
        chatType,
        toUserName: msg.ToUserName,
        agentId: msg.AgentID,
      }),
    }).catch((err) => {
      this.#logger.warn(formatCompact({
        op: 'wecom_gateway_receive_failed',
        target: `${conversation.kind}:${conversation.id}`,
        error: err instanceof Error ? err.message : String(err),
      }));
    });
  }

  async getUserInfo(userId: string): Promise<WecomApiResponse | null> {
    try {
      const data = await this.#request('/cgi-bin/user/get', {
        params: { userid: userId },
      });
      if (data.errcode === 0) return data;
      throw new Error(`Failed to get user info: ${data.errmsg}`);
    } catch (error) {
      this.#logger.error('Failed to get user info:', error);
      return null;
    }
  }

  async getDepartmentUsers(deptId: number): Promise<unknown[]> {
    try {
      const data = await this.#request('/cgi-bin/user/simplelist', {
        params: { department_id: deptId },
      });
      if (data.errcode === 0) return (data.userlist as unknown[]) || [];
      throw new Error(`Failed to get department users: ${data.errmsg}`);
    } catch (error) {
      this.#logger.error('Failed to get department users:', error);
      return [];
    }
  }

  async getDepartmentList(deptId: number = 1): Promise<unknown[]> {
    try {
      const data = await this.#request('/cgi-bin/department/list', {
        params: { id: deptId },
      });
      if (data.errcode === 0) return (data.department as unknown[]) || [];
      throw new Error(`Failed to get department list: ${data.errmsg}`);
    } catch (error) {
      this.#logger.error('Failed to get department list:', error);
      return [];
    }
  }

  async sendTextMessage(userId: string, content: string): Promise<boolean> {
    try {
      const endpointKey = String(this.#options.id);
      await this.send({
        conversation: {
          endpoint: { id: endpointKey, adapter: endpointKey.split('\0')[0] ?? endpointKey },
          kind: resolveChatType(userId),
          id: userId,
        },
        payload: content,
      });
      return true;
    } catch (error) {
      this.#logger.error('Failed to send text message:', error);
      return false;
    }
  }

  async #request(
    path: string,
    options: {
      method?: 'GET' | 'POST';
      params?: Record<string, string | number>;
      body?: Record<string, unknown>;
    } = {},
  ): Promise<WecomApiResponse> {
    await this.#ensureAccessToken();
    const { method = 'GET', params = {}, body } = options;
    const urlParams = new URLSearchParams({
      ...Object.fromEntries(
        Object.entries(params).map(([key, value]) => [key, String(value)]),
      ),
      access_token: this.#accessToken.access_token,
    });
    const url = `${this.#options.config.apiBaseUrl}${path}?${urlParams.toString()}`;
    const response = await this.#fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: body && method === 'POST' ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`WeCom API error ${response.status}: ${text}`);
    }
    return await response.json() as WecomApiResponse;
  }

  async #ensureAccessToken(): Promise<void> {
    const now = Date.now();
    if (
      this.#accessToken.access_token
      && now < this.#accessToken.timestamp + (this.#accessToken.expires_in - 300) * 1000
    ) {
      return;
    }
    if (this.#refreshPromise) {
      await this.#refreshPromise;
      return;
    }
    this.#refreshPromise = this.#refreshAccessToken()
      .then(() => this.#accessToken.access_token)
      .finally(() => { this.#refreshPromise = null; });
    await this.#refreshPromise;
  }

  async #refreshAccessToken(): Promise<void> {
    const { corpId, agentSecret, apiBaseUrl } = this.#options.config;
    const url = `${apiBaseUrl}/cgi-bin/gettoken?corpid=${corpId}&corpsecret=${agentSecret}`;
    const response = await this.#fetch(url);
    const data = await response.json() as WecomApiResponse;
    if (data.errcode === 0 && data.access_token) {
      this.#accessToken = {
        access_token: data.access_token,
        expires_in: data.expires_in ?? 7200,
        timestamp: Date.now(),
      };
      this.#logger.debug('Access token refreshed successfully');
      return;
    }
    throw new Error(`Failed to get access token: ${data.errmsg} (${data.errcode})`);
  }
}
