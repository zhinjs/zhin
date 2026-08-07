/**
 * LarkEndpoint — lifecycle, outbound, admit, OpenAPI helpers for agent tools.
 */
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { EndpointGroup, EndpointInstance, EndpointManagement, EndpointSendRequest } from '@zhin.js/adapter';
import type { MessageGateway } from '@zhin.js/core/runtime';
import type { HttpHost, HttpRouteRegistration } from '@zhin.js/host-http';
import { formatCompact, getAdapterLogger } from '@zhin.js/logger';
import type { CapabilityId } from '@zhin.js/plugin-runtime';
import { registerLarkAgentEndpoint } from './lark-agent-deps.js';
import {
  buildImageUploadForm,
  readOutboundImageMedia,
  resolveMediaBinary,
} from './media-upload.js';
import {
  formatInboundContent,
  formatOutboundBody,
  generateMessageId,
  larkInboundConversation,
  resolveChatType,
  resolveSender,
  type AccessToken,
  type LarkApiResponse,
  type LarkMessage,
  type ResolvedLarkConfig,
} from './protocol.js';
import { registerLarkWebhookRoutes } from './webhook.js';

/** 出站 HTTP 调用统一 30s 超时。 */
const OUTBOUND_TIMEOUT_MS = 30_000;

export type LarkFetch = (
  url: string,
  init?: {
    readonly method?: string;
    readonly headers?: Record<string, string>;
    readonly body?: string | FormData;
    readonly signal?: AbortSignal;
  },
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}>;

export interface LarkEndpointOptions {
  readonly id: CapabilityId;
  readonly gateway: MessageGateway;
  readonly http: HttpHost;
  readonly config: ResolvedLarkConfig;
  readonly fetch?: LarkFetch;
}

export class LarkEndpoint implements EndpointInstance {
  readonly #logger!: ReturnType<typeof getAdapterLogger>;

  readonly #options: LarkEndpointOptions;
  readonly #fetch: LarkFetch;
  /**
   * Console 社交面语义端口。Lark OpenAPI 仅接读取类列表能力：
   * - listGroups：GET /im/v1/chats（bot 所在群列表，分页归一为 {group_id: chat_id, name}）
   * - listGroupMembers：GET /im/v1/chats/:chat_id/members（open_id 分页，返回平台原生成员形状）
   * 不接的项：listFriends（Lark 无好友概念，contact API 为组织通讯录而非社交关系）、
   * listChannels（无频道/guild 概念）、写操作（审批/踢人/禁言等本轮不在范围内）。
   */
  readonly management: EndpointManagement = Object.freeze<EndpointManagement>({
    listGroups: async (): Promise<readonly EndpointGroup[]> => {
      const items = await this.#listAllPages('/im/v1/chats');
      const groups: EndpointGroup[] = [];
      for (const item of items) {
        const chatId = typeof item.chat_id === 'string' ? item.chat_id : '';
        if (!chatId) continue;
        groups.push({
          group_id: chatId,
          name: typeof item.name === 'string' && item.name ? item.name : chatId,
        });
      }
      return groups;
    },
    listGroupMembers: (groupId) => this.#listAllPages(
      `/im/v1/chats/${encodeURIComponent(groupId)}/members`,
      { member_id_type: 'open_id' },
    ),
  });
  #routeReleases: HttpRouteRegistration[] = [];
  #accessToken: AccessToken = { token: '', expires_in: 0, timestamp: 0 };
  #refreshPromise: Promise<string> | null = null;
  #open = false;
  #started = false;
  #unregisterAgent?: () => void;

  constructor(options: LarkEndpointOptions) {
    this.#logger = getAdapterLogger('lark', options.config.name);
    this.#options = options;
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  /** Used by webhook handler. */
  get isOpen(): boolean {
    return this.#open;
  }

  get config(): ResolvedLarkConfig {
    return this.#options.config;
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    try {
      if (!this.#options.config.encryptKey && !this.#options.config.verificationToken) {
        // encryptKey / verificationToken 都未配置时 webhook 完全无鉴权，任何人可伪造事件
        this.#logger.warn(formatCompact({
          endpoint: this.#options.config.name,
          op: 'webhook',
          ok: false,
          error: 'neither encryptKey nor verificationToken configured; webhook is unauthenticated',
        }));
      }
      await this.#refreshAccessToken();
      this.#unregisterAgent = registerLarkAgentEndpoint(this.#options.config.name, this);
      this.#routeReleases.push(...registerLarkWebhookRoutes(this.#options.http, this));
      this.#logger.debug(formatCompact({
        endpoint: this.#options.config.name,
        op: 'webhook',
        path: this.#options.config.webhookPath,
      }));
    } catch (error) {
      await this.stop();
      this.#logger.error('Failed to connect Lark endpoint:', error);
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
    const data = await this.#request('/im/v1/messages', {
      method: 'POST',
      params: { receive_id_type: 'chat_id' },
      body: {
        receive_id: conversation.id,
        msg_type: content.msg_type,
        content: content.content,
      },
    });
    if (data.code !== 0) {
      throw new Error(`Failed to send message: ${data.msg}`);
    }
    const messageId = (data.data?.message_id as string) || `${Date.now()}`;
    this.#logger.debug(formatCompact({ op: 'send', to: conversation.id,
      id: messageId,
    }));
    return messageId;
  }

  async recallMessage(messageId: string): Promise<void> {
    if (!messageId || messageId.startsWith('outbound:')) return;
    await this.#request(`/im/v1/messages/${messageId}`, { method: 'DELETE' });
  }

  /**
   * im/v1 消息 image 段只接受 image_key：canonical MediaRef（base64/本地路径/URL）
   * 先经 /im/v1/images 物化，产物回写为 MediaRef kind=file（平台不透明引用）；
   * 上传失败降级为文本（alt 优先），不阻断发送。
   */
  async #materializeOutboundMedia(payload: unknown): Promise<unknown> {
    if (!Array.isArray(payload)) return payload;
    return Promise.all(payload.map(async (item) => {
      if (typeof item === 'string' || !item || typeof item !== 'object') return item;
      const seg = item as { type?: unknown; data?: Record<string, unknown> };
      if (seg.type !== 'image') return item;
      const data = seg.data ?? {};
      const media = readOutboundImageMedia(data);
      if (!media) return item;
      const imageKey = await this.uploadImage(media);
      if (!imageKey) {
        const alt = typeof data.alt === 'string' && data.alt ? data.alt : '[image]';
        return { type: 'text', data: { text: alt } };
      }
      return {
        type: 'image',
        data: { media: { kind: 'file', value: imageKey } },
      };
    }));
  }

  /** POST /im/v1/images（image_type=message），返回 image_key；失败返回 null。 */
  async uploadImage(media: Parameters<typeof resolveMediaBinary>[0]): Promise<string | null> {
    try {
      await this.#ensureAccessToken();
      const binary = await resolveMediaBinary(media);
      const form = buildImageUploadForm(binary);
      const url = `${this.#options.config.apiBaseUrl}/im/v1/images`;
      const response = await this.#fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.#accessToken.token}` },
        body: form,
        signal: AbortSignal.timeout(OUTBOUND_TIMEOUT_MS),
      });
      const data = await response.json() as LarkApiResponse;
      if (data.code === 0) {
        return (data.data?.image_key as string) || null;
      }
      throw new Error(`Image upload failed: ${data.msg}`);
    } catch (error) {
      this.#logger.error('Failed to upload image:', error);
      return null;
    }
  }

  /** Test / internal: admit a parsed message when open (non-webhook path). */
  admit(msg: LarkMessage): void {
    if (!this.#open) return;
    const conversation = larkInboundConversation(String(this.#options.id), msg);
    void this.#options.gateway.receive({
      conversation,
      message: { conversation, id: generateMessageId(msg) },
      content: formatInboundContent(msg),
      sender: resolveSender(msg),
      metadata: Object.freeze({
        messageType: msg.message_type,
        chatType: resolveChatType(msg.chat_id, msg.chat_type),
        endpoint: this.#options.config.name,
      }),
    }).catch((err) => {
      this.#logger.warn(formatCompact({
        op: 'lark_gateway_receive_failed',
        conversation: conversation.id,
        error: err instanceof Error ? err.message : String(err),
      }));
    });
  }

  async getUserInfo(
    userId: string,
    userIdType: 'open_id' | 'user_id' | 'union_id' = 'open_id',
  ): Promise<unknown> {
    try {
      const data = await this.#request(`/contact/v3/users/${userId}`, {
        method: 'GET',
        params: { user_id_type: userIdType },
      });
      return data.data?.user ?? null;
    } catch (error) {
      this.#logger.error('Failed to get user info:', error);
      return null;
    }
  }

  async getChatInfo(chatId: string): Promise<unknown> {
    try {
      const data = await this.#request(`/im/v1/chats/${chatId}`, { method: 'GET' });
      return data.data ?? null;
    } catch (error) {
      this.#logger.error('Failed to get chat info:', error);
      return null;
    }
  }

  async uploadFile(
    filePath: string,
    fileType: 'image' | 'file' | 'video' | 'audio' = 'file',
  ): Promise<string | null> {
    try {
      await this.#ensureAccessToken();
      const buf = await readFile(filePath);
      const form = new FormData();
      form.append('file', new Blob([buf]), basename(filePath));
      form.append('file_type', fileType);
      const url = `${this.#options.config.apiBaseUrl}/im/v1/files`;
      const response = await this.#fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.#accessToken.token}` },
        body: form,
      });
      const data = await response.json() as LarkApiResponse;
      if (data.code === 0) {
        return (data.data?.file_key as string) || null;
      }
      throw new Error(`Upload failed: ${data.msg}`);
    } catch (error) {
      this.#logger.error('Failed to upload file:', error);
      return null;
    }
  }

  async createChat(
    name: string,
    userIds: string[],
    ownerId?: string,
  ): Promise<string | null> {
    try {
      const data = await this.#request('/im/v1/chats', {
        method: 'POST',
        body: {
          name,
          user_id_list: userIds,
          ...(ownerId ? { owner_id: ownerId } : {}),
        },
      });
      if (data.code === 0) return (data.data?.chat_id as string) || null;
      throw new Error(`Failed to create chat: ${data.msg}`);
    } catch (error) {
      this.#logger.error('Failed to create chat:', error);
      return null;
    }
  }

  async updateChatInfo(
    chatId: string,
    options: { name?: string; description?: string },
  ): Promise<boolean> {
    try {
      const data = await this.#request(`/im/v1/chats/${chatId}`, {
        method: 'PUT',
        body: options,
      });
      if (data.code === 0) return true;
      throw new Error(`Failed to update chat: ${data.msg}`);
    } catch (error) {
      this.#logger.error('Failed to update chat:', error);
      return false;
    }
  }

  async addChatMembers(chatId: string, userIds: string[]): Promise<boolean> {
    try {
      const data = await this.#request(`/im/v1/chats/${chatId}/members`, {
        method: 'POST',
        body: { id_list: userIds },
      });
      if (data.code === 0) return true;
      throw new Error(`Failed to add members: ${data.msg}`);
    } catch (error) {
      this.#logger.error('Failed to add chat members:', error);
      return false;
    }
  }

  async removeChatMembers(chatId: string, userIds: string[]): Promise<boolean> {
    try {
      const data = await this.#request(`/im/v1/chats/${chatId}/members`, {
        method: 'DELETE',
        body: { id_list: userIds },
      });
      if (data.code === 0) return true;
      throw new Error(`Failed to remove members: ${data.msg}`);
    } catch (error) {
      this.#logger.error('Failed to remove chat members:', error);
      return false;
    }
  }

  async getChatMembers(chatId: string): Promise<unknown[]> {
    try {
      const data = await this.#request(`/im/v1/chats/${chatId}/members`, { method: 'GET' });
      if (data.code === 0) return (data.data?.items as unknown[]) || [];
      throw new Error(`Failed to get members: ${data.msg}`);
    } catch (error) {
      this.#logger.error('Failed to get chat members:', error);
      return [];
    }
  }

  async dissolveChat(chatId: string): Promise<boolean> {
    try {
      const data = await this.#request(`/im/v1/chats/${chatId}`, { method: 'DELETE' });
      if (data.code === 0) return true;
      throw new Error(`Failed to dissolve chat: ${data.msg}`);
    } catch (error) {
      this.#logger.error('Failed to dissolve chat:', error);
      return false;
    }
  }

  async setChatManagers(chatId: string, userIds: string[]): Promise<boolean> {
    try {
      const data = await this.#request(`/im/v1/chats/${chatId}/managers/add_managers`, {
        method: 'POST',
        body: { manager_ids: userIds },
      });
      if (data.code === 0) return true;
      throw new Error(`Failed to set managers: ${data.msg}`);
    } catch (error) {
      this.#logger.error('Failed to set chat managers:', error);
      return false;
    }
  }

  async removeChatManagers(chatId: string, userIds: string[]): Promise<boolean> {
    try {
      const data = await this.#request(`/im/v1/chats/${chatId}/managers/delete_managers`, {
        method: 'POST',
        body: { manager_ids: userIds },
      });
      if (data.code === 0) return true;
      throw new Error(`Failed to remove managers: ${data.msg}`);
    } catch (error) {
      this.#logger.error('Failed to remove chat managers:', error);
      return false;
    }
  }

  /** 拉取分页列表（items + has_more/page_token）；code!==0 时抛错交由 RPC 层透出。 */
  async #listAllPages(
    path: string,
    params: Record<string, string | number> = {},
  ): Promise<Record<string, unknown>[]> {
    const items: Record<string, unknown>[] = [];
    let pageToken = '';
    do {
      const data = await this.#request(path, {
        method: 'GET',
        params: {
          ...params,
          page_size: 100,
          ...(pageToken ? { page_token: pageToken } : {}),
        },
      });
      if (data.code !== 0) {
        throw new Error(`Lark API ${path} failed: ${data.msg ?? 'unknown'} (${data.code})`);
      }
      const page = data.data ?? {};
      if (Array.isArray(page.items)) {
        for (const item of page.items) {
          if (item !== null && typeof item === 'object') {
            items.push(item as Record<string, unknown>);
          }
        }
      }
      pageToken = page.has_more === true && typeof page.page_token === 'string'
        ? page.page_token
        : '';
    } while (pageToken);
    return items;
  }

  async #request(
    path: string,
    options: {
      method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
      params?: Record<string, string | number>;
      body?: Record<string, unknown>;
    } = {},
  ): Promise<LarkApiResponse> {
    await this.#ensureAccessToken();
    const { method = 'GET', params = {}, body } = options;
    const urlParams = new URLSearchParams(
      Object.fromEntries(
        Object.entries(params).map(([key, value]) => [key, String(value)]),
      ),
    );
    const query = urlParams.toString();
    const url = `${this.#options.config.apiBaseUrl}${path}${query ? `?${query}` : ''}`;
    const response = await this.#fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${this.#accessToken.token}`,
      },
      body: body && method !== 'GET' ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(OUTBOUND_TIMEOUT_MS),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Lark API error ${response.status}: ${text}`);
    }
    return await response.json() as LarkApiResponse;
  }

  async #ensureAccessToken(): Promise<void> {
    const now = Date.now();
    if (
      this.#accessToken.token
      && now < this.#accessToken.timestamp + (this.#accessToken.expires_in - 300) * 1000
    ) {
      return;
    }
    if (this.#refreshPromise) {
      await this.#refreshPromise;
      return;
    }
    this.#refreshPromise = this.#refreshAccessToken()
      .then(() => this.#accessToken.token)
      .finally(() => { this.#refreshPromise = null; });
    await this.#refreshPromise;
  }

  async #refreshAccessToken(): Promise<void> {
    const { appId, appSecret, apiBaseUrl } = this.#options.config;
    const url = `${apiBaseUrl}/auth/v3/tenant_access_token/internal`;
    const response = await this.#fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    });
    const data = await response.json() as LarkApiResponse;
    if (data.code === 0 && data.tenant_access_token) {
      this.#accessToken = {
        token: data.tenant_access_token,
        expires_in: data.expire ?? 7200,
        timestamp: Date.now(),
      };
      this.#logger.debug('Access token refreshed successfully');
      return;
    }
    throw new Error(`Failed to get access token: ${data.msg} (${data.code})`);
  }
}
