import { Client as SdkClient, LoggerLevel, DefaultCache } from '@larksuiteoapi/node-sdk';
import { createLarkSdkHttpInstance } from './sdk-http.js';
import { createLarkWebApiTransport } from './web-api-proxy.js';
import type { LarkCardAction } from './cards.js';
import { EndpointDeliveryError, type ConversationRef } from '@zhin.js/im-contract';
/**
 * LarkEndpoint — lifecycle, outbound, admit, OpenAPI helpers for agent tools.
 */
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import {
  createEndpointLifecycle,
  createEndpointOperation,
  type EndpointLifecycle,
  type EndpointTransportState,
  createRecallEndpointControl,
  type EndpointControl,
  type EndpointGroup,
  type EndpointManagement,
  type EndpointSendRequest,
  type EndpointManagementRequest,
  type EndpointGroupRequest,
} from 'zhin.js/adapter';
import type { HttpHost, HttpRouteRegistration } from '@zhin.js/host-http';
import { formatCompact, getAdapterLogger } from '@zhin.js/logger';
import type { CapabilityId } from 'zhin.js';
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
  type LarkApiResponse,
  type LarkMessage,
  type ResolvedLarkConfig,
} from './protocol.js';
import { normalizeLarkSenderForPermit } from './platform-permit.js';
import { registerLarkWebhookRoutes } from './webhook.js';
import { createLarkLongConnection, type LarkLongConnectionFactory } from './long-connection.js';

/** 出站 HTTP 调用统一 30s 超时。 */
const OUTBOUND_TIMEOUT_MS = 30_000;

export type LarkFetch = (
  url: string,
  init?: {
    readonly method?: string;
    readonly headers?: Record<string, string>;
    readonly body?: string | FormData | Uint8Array | ArrayBuffer | AsyncIterable<Uint8Array>;
    readonly duplex?: 'half';
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
  readonly http?: HttpHost;
  readonly longConnectionFactory?: LarkLongConnectionFactory;
  readonly config: ResolvedLarkConfig;
  readonly signal?: AbortSignal;
  readonly fetch?: LarkFetch;
}

export interface LarkClientApi {
  getUserInfo(userId: string, userIdType?: 'open_id' | 'user_id' | 'union_id'): Promise<unknown>;
  getChatInfo(chatId: string): Promise<unknown>;
  uploadFile(filePath: string, fileType?: 'image' | 'file' | 'video' | 'audio'): Promise<string | null>;
  createChat(name: string, userIds: string[], ownerId?: string): Promise<string | null>;
  updateChatInfo(chatId: string, options: { name?: string; description?: string }): Promise<boolean>;
  addChatMembers(chatId: string, userIds: string[]): Promise<boolean>;
  removeChatMembers(chatId: string, userIds: string[]): Promise<boolean>;
  getChatMembers(chatId: string): Promise<unknown[]>;
  dissolveChat(chatId: string): Promise<boolean>;
  setChatManagers(chatId: string, userIds: string[]): Promise<boolean>;
  removeChatManagers(chatId: string, userIds: string[]): Promise<boolean>;
}

/** Feishu/Lark OpenAPI client surface carried by every Endpoint event. */

const LARK_CHAT_MANAGER_CACHE_TTL_MS = 60_000;

export class LarkClient extends SdkClient {
  readonly #logger!: ReturnType<typeof getAdapterLogger>;

  readonly #options: LarkEndpointOptions;
  readonly #fetch: LarkFetch;
  readonly #webApiTransport?: ReturnType<typeof createLarkWebApiTransport>;
  /**
   * Console 社交面语义端口。Lark OpenAPI 仅接读取类列表能力：
   * - listGroups：GET /im/v1/chats（bot 所在群列表，分页归一为 {group_id: chat_id, name}）
   * - listGroupMembers：GET /im/v1/chats/:chat_id/members（open_id 分页，返回平台原生成员形状）
   * 不接的项：listFriends（Lark 无好友概念，contact API 为组织通讯录而非社交关系）、
   * listChannels（无频道/guild 概念）、写操作（审批/踢人/禁言等本轮不在范围内）。
   */
  protected readonly endpointManagement: EndpointManagement = Object.freeze<EndpointManagement>({
    listGroups: async (request: EndpointManagementRequest = {}): Promise<readonly EndpointGroup[]> => {
      const items = await this.#listAllPages('/im/v1/chats', request);
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
    listGroupMembers: ({ groupId, signal }: EndpointGroupRequest) => this.#listAllPages(
      `/im/v1/chats/${encodeURIComponent(groupId)}/members`,
      { params: { member_id_type: 'open_id' }, signal },
    ),
  });
  protected readonly endpointControl: EndpointControl = createRecallEndpointControl((id, signal) => this.recallMessage(id, { signal }));
  #routeReleases: HttpRouteRegistration[] = [];

  #open = false;
  #started = false;
  readonly #lifecycle: EndpointLifecycle;
  readonly #cardSources = new Map<string, { conversation: ConversationRef; time: number }>();
  readonly #seen = new Map<string, number>();
  readonly #chatManagers = new Map<string, { at: number; owner?: string; admins: ReadonlySet<string> }>();
  /** One chat.get per chat at a time: concurrent messages on a cache miss share the lookup. */
  readonly #chatManagerLookups = new Map<string, Promise<{ at: number; owner?: string; admins: ReadonlySet<string> }>>();
  #startupGeneration = 0;
  readonly #pendingInbound: { message: LarkMessage; event: unknown }[] = [];

  readonly #bindSignal: (signal: AbortSignal) => void;
  protected configName(): string { return this.#options.config.id; }
  /** Native protocol work runs here; Endpoint attaches the framework receipt without replacing SDK APIs. */
  protected receiveInboundCallback<T>(receive: () => T | Promise<T>): Promise<T> {
    try { return Promise.resolve(receive()); } catch (error) { return Promise.reject(error); }
  }
  protected publishEvent(_name: string, _payload: unknown): Promise<unknown> { return Promise.resolve(); }
  protected publishAccepted(name: string, payload: unknown): Promise<void> { return this.publishEvent(name, payload).then(() => undefined); }
  protected publishPlatform(_name: string, _event: unknown): Promise<unknown> { return Promise.resolve(); }

  constructor(options: LarkEndpointOptions) {
    if (options.config.webApiProxy && options.fetch) throw new TypeError('Lark webApiProxy cannot be combined with an injected fetch');
    const transport = options.config.webApiProxy ? createLarkWebApiTransport(options.config.webApiProxy) : undefined;
    const fetch: LarkFetch = transport?.fetch ?? options.fetch ?? ((url, init) => globalThis.fetch(url, init as RequestInit));
    let executionSignal: AbortSignal | undefined = options.signal;
    const wire: LarkFetch = (url, init) => {
      executionSignal?.throwIfAborted();
      return fetch(url, { ...init, ...(executionSignal ? { signal: init?.signal ? AbortSignal.any([executionSignal, init.signal]) : executionSignal } : {}) });
    };
    super({ appId: options.config.appId, appSecret: options.config.appSecret,
      domain: options.config.apiBaseUrl.replace(/\/open-apis$/, ''), loggerLevel: LoggerLevel.error,
      httpInstance: createLarkSdkHttpInstance(wire), cache: new DefaultCache() });
    this.#bindSignal = signal => { executionSignal = signal; };
    this.#webApiTransport = transport;
    this.#logger = getAdapterLogger('lark', options.config.id);
    this.#options = options;
    this.#fetch = wire;
    this.#lifecycle = createEndpointLifecycle({ name: options.config.id });
  }

  /** Used by webhook handler. */
  get isOpen(): boolean {
    return this.#open;
  }

  get config(): ResolvedLarkConfig {
    return this.#options.config;
  }

  get transportState(): EndpointTransportState | undefined {
    return this.config.mode === 'websocket' ? this.#lifecycle.state : undefined;
  }

  async [Symbol.asyncDispose](): Promise<void> { await this.disconnectTransport(); }

  protected async connectTransport(signal?: AbortSignal): Promise<void> {
    if (signal) { this.#bindSignal(signal); signal.throwIfAborted(); }
    if (this.#started) return;
    this.#webApiTransport?.reopen();
    this.#started = true;
    const generation = ++this.#startupGeneration;
    try {
      if (this.config.mode === 'websocket') {
        await this.#lifecycle.start(async (handle) => {
          let active = true;
          const transport = (this.#options.longConnectionFactory ?? createLarkLongConnection)({
            config: this.config,
            receive: (message, nativeEvent) => {
              if (!active || !this.#started || generation !== this.#startupGeneration) return;
              if (this.#open) this.admit(message, nativeEvent);
              else if (this.#pendingInbound.length < 100) this.#pendingInbound.push({ message, event: nativeEvent });
              else this.#logger.warn('lark_inbound_startup_buffer_full');
            },
            cardAction: (event) => { if (active && this.#open && generation === this.#startupGeneration) this.admitCardAction(event); },
            disconnected: () => { if (!active) return; active = false; transport.close(); handle.notifyClosed(); },
          });
          handle.onForceClose(() => { active = false; transport.close(); });
          await transport.connect();
        });
        return;
      }
      if (!this.#options.config.encryptKey && !this.#options.config.verificationToken) {
        // encryptKey / verificationToken 都未配置时 webhook 完全无鉴权，任何人可伪造事件
        this.#logger.warn(formatCompact({
          endpoint: this.#options.config.id,
          op: 'webhook',
          ok: false,
          error: 'neither encryptKey nor verificationToken configured; webhook is unauthenticated',
        }));
      }
      await this.#refreshAccessToken();
      if (!this.#started || generation !== this.#startupGeneration) return;
      if (!this.#options.http) throw new Error('Lark webhook mode requires HttpHost');
      this.#routeReleases.push(...registerLarkWebhookRoutes(this.#options.http, this));
      this.#logger.debug(formatCompact({
        endpoint: this.#options.config.id,
        op: 'webhook',
        path: this.#options.config.webhookPath,
      }));
    } catch (error) {
      await this.disconnectTransport();
      this.#logger.error('Failed to connect Lark endpoint:', error);
      throw error;
    }
  }

  protected openInput(): void {
    this.#open = true;
    for (const pending of this.#pendingInbound.splice(0)) this.admit(pending.message, pending.event);
  }

  protected closeInput(): void {
    this.#open = false;
  }

  protected async disconnectTransport(): Promise<void> {
    this.#open = false;
    this.#pendingInbound.length = 0;
    this.#cardSources.clear();
    this.#started = false;
    ++this.#startupGeneration;
    await this.#lifecycle.stop();
    await this.#webApiTransport?.close();
    for (const release of this.#routeReleases.splice(0)) release();
    this.#started = false;
    this.#logger.debug(formatCompact({ op: 'disconnect' }));
  }

  protected async sendPayload({ conversation, payload, locale, signal }: EndpointSendRequest): Promise<string> {
    try {
      const materialized = await createEndpointOperation({ signal }).prepare(() => this.#materializeOutboundMedia(payload, { signal }));
      const content = formatOutboundBody(materialized, locale);
      const data = await this.#request(content.replyTo
        ? `/im/v1/messages/${encodeURIComponent(content.replyTo)}/reply`
        : '/im/v1/messages', {
        method: 'POST',
        signal,
        ...(content.replyTo ? {} : { params: { receive_id_type: 'chat_id' } }),
        body: {
          ...(content.replyTo ? {} : { receive_id: conversation.id }),
          msg_type: content.msg_type,
          content: content.content,
        },
      });
      if (typeof data.code === 'number' && data.code !== 0) {
        throw new EndpointDeliveryError('platform_rejected', `Lark rejected message (code=${data.code})`, 'rejected');
      }
      if (data.code !== 0) throw new EndpointDeliveryError('delivery_unconfirmed', 'Malformed platform response', 'unknown');
      const messageId = requireMessageId(data.data?.message_id);
      if (content.msg_type === 'interactive') {
        const now = Date.now();
        for (const [id, source] of this.#cardSources) if (now - source.time > 300_000) this.#cardSources.delete(id);
        this.#cardSources.set(messageId, { conversation, time: now });
        if (this.#cardSources.size > 10_000) this.#cardSources.delete(this.#cardSources.keys().next().value!);
      }
      this.#logger.debug(formatCompact({ op: 'send', to: conversation.id,
        id: messageId,
      }));
      return messageId;
    } catch (error) {
      this.#logger.warn(formatCompact({
        op: 'lark_send_failed',
        status: error instanceof LarkRequestError ? error.status : undefined,
        platform_code: error instanceof LarkRequestError ? error.platformCode : undefined,
        outcome: error instanceof EndpointDeliveryError ? error.disposition : 'unknown',
      }));
      if (error instanceof EndpointDeliveryError) throw error;
      throw new EndpointDeliveryError('delivery_unconfirmed', 'Outbound request outcome is unknown', 'unknown', { cause: error });
    }
  }

  async recallMessage(messageId: string, { signal }: EndpointManagementRequest = {}): Promise<void> {
    if (!messageId || messageId.startsWith('outbound:')) return;
    await this.#request(`/im/v1/messages/${encodeURIComponent(messageId)}`, { method: 'DELETE', signal });
  }

  /**
   * im/v1 消息 image 段只接受 image_key：canonical MediaRef（base64/本地路径/URL）
   * 先经 /im/v1/images 物化，产物回写为 MediaRef kind=file（平台不透明引用）；
   * 上传失败阻止消息发送并保留拒绝或未知分类。
   */
  async #materializeOutboundMedia(payload: unknown, request: EndpointManagementRequest): Promise<unknown> {
    if (!Array.isArray(payload)) return payload;
    return Promise.all(payload.map(async (item) => {
      if (typeof item === 'string' || !item || typeof item !== 'object') return item;
      const seg = item as { type?: unknown; data?: Record<string, unknown> };
      if (seg.type !== 'image') return item;
      const data = seg.data ?? {};
      const media = readOutboundImageMedia(data);
      if (!media) return item;
      const imageKey = await this.uploadImage(media, request);
      if (!imageKey) throw new EndpointDeliveryError('delivery_unconfirmed', 'Lark image upload returned no image key', 'unknown');
      return {
        type: 'image',
        data: { media: { kind: 'file', value: imageKey } },
      };
    }));
  }

  /** Upload must succeed before issuing a message; dropped media is never confirmed. */
  async uploadImage(media: Parameters<typeof resolveMediaBinary>[0], request: EndpointManagementRequest = {}): Promise<string> {
    const operation = createEndpointOperation(request);
    const token = await operation.prepare(() => this.#ensureAccessToken());
    const binary = await operation.prepare(() => resolveMediaBinary(media, request));
    const form = buildImageUploadForm(binary);
    const response = await this.#fetch(`${this.#options.config.apiBaseUrl}/im/v1/images`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      signal: request.signal ? AbortSignal.any([request.signal, AbortSignal.timeout(OUTBOUND_TIMEOUT_MS)]) : AbortSignal.timeout(OUTBOUND_TIMEOUT_MS),
    });
    const data = await response.json().catch(() => undefined) as LarkApiResponse | undefined;
    const code = typeof data?.code === 'number' && Number.isFinite(data.code) ? data.code : undefined;
    if (!response.ok) throw new LarkRequestError(response.status, code, response.status >= 400 && response.status < 500 && response.status !== 408);
    if (code !== 0) throw new LarkRequestError(response.status, code, code !== undefined);
    const key = data?.data?.image_key;
    if (typeof key !== 'string' || !key.trim()) throw new LarkRequestError(response.status, code, false);
    return key;
  }

  /** Test / internal: admit a parsed message when open (non-webhook path). */
  admit(msg: LarkMessage, nativeEvent: unknown = msg): void {
    if (!this.#open) return;
    void this.receiveInboundCallback(async () => {
      if (msg.message_id) {
        const now = Date.now();
        for (const [id, time] of this.#seen) if (now - time > 300_000) this.#seen.delete(id);
        if (this.#seen.has(msg.message_id)) return;
        this.#seen.set(msg.message_id, now);
        if (this.#seen.size > 10_000) this.#seen.delete(this.#seen.keys().next().value!);
      }
      await this.#emitInbound(msg, larkInboundConversation(String(this.#options.id), msg), nativeEvent);
    }).catch((err) => this.#logger.warn(formatCompact({ op: 'lark_gateway_receive_failed',
      conversation: msg.chat_id, error: err instanceof Error ? err.message : String(err) })));
  }

  async #emitInbound(msg: LarkMessage, conversation: ConversationRef, nativeEvent: unknown): Promise<void> {
    const chatType = resolveChatType(msg.chat_id, msg.chat_type);
    const senderId = resolveSender(msg);
    const permit = senderId && chatType === 'group' && msg.chat_id
      ? normalizeLarkSenderForPermit(await this.#resolveChatRole(msg.chat_id, senderId))
      : undefined;
    // 规范角色 owner / admin 进 roles；细粒度能力放 senderPermissions
    const role = permit?.role === 'owner' || permit?.role === 'admin' ? permit.role : undefined;
    await this.publishEvent('message.receive', {
      event: nativeEvent,
      conversation,
      message: { conversation, id: generateMessageId(msg) },
      content: formatInboundContent(msg),
      ...(senderId ? { sender: { id: senderId, ...(role ? { roles: [role] } : {}) } } : {}),
      endpointId: this.#options.config.id,
      metadata: Object.freeze({
        messageType: msg.message_type,
        chatType,
        ...(role ? { senderRole: role } : {}),
        ...(role && permit?.permissions?.length ? { senderPermissions: [...permit.permissions] } : {}),
      }),
    });
  }

  /** 群主 / 群管理员来自 chat.get（owner_id + 管理员列表），按群缓存；失败时保守地视为普通成员。 */
  async #resolveChatRole(chatId: string, senderId: string): Promise<{ isOwner: boolean; isAdmin: boolean }> {
    const now = Date.now();
    for (const [id, entry] of this.#chatManagers) if (now - entry.at > LARK_CHAT_MANAGER_CACHE_TTL_MS) this.#chatManagers.delete(id);
    let entry = this.#chatManagers.get(chatId);
    if (!entry) {
      let lookup = this.#chatManagerLookups.get(chatId);
      if (!lookup) {
        lookup = (async () => {
          const info = await this.getChatInfo(chatId) as {
            owner_id?: unknown;
            user_manager_id_list?: unknown;
          } | null;
          const admins = Array.isArray(info?.user_manager_id_list) ? info.user_manager_id_list.map(String) : [];
          const fetched = {
            at: Date.now(),
            ...(typeof info?.owner_id === 'string' && info.owner_id ? { owner: info.owner_id } : {}),
            admins: new Set(admins) as ReadonlySet<string>,
          };
          this.#chatManagers.set(chatId, fetched);
          return fetched;
        })().finally(() => this.#chatManagerLookups.delete(chatId));
        this.#chatManagerLookups.set(chatId, lookup);
      }
      entry = await lookup;
    }
    return {
      isOwner: entry.owner !== undefined && entry.owner === senderId,
      isAdmin: entry.admins.has(senderId),
    };
  }

  /** Only correlate callbacks to a card actually sent by this endpoint. */
  admitCardAction(event: LarkCardAction): void {
    if (!this.#open) return;
    void this.receiveInboundCallback(() => this.#admitCardAction(event)).catch(() => this.#logger.warn('lark_card_action_receive_failed'));
  }

  #admitCardAction(event: LarkCardAction): void {
    if (!this.#open) return;
    const sourceId = event.context?.open_message_id ?? event.open_message_id;
    const chatId = event.context?.open_chat_id ?? event.open_chat_id;
    const sender = event.operator?.open_id ?? event.operator?.user_id;
    const payload = event.action?.value?.zhin_payload;
    if (!sourceId || !chatId || !sender || typeof payload !== 'string' || event.action?.tag !== 'button') return;
    const source = this.#cardSources.get(sourceId);
    if (!source || source.conversation.id !== chatId || Date.now() - source.time > 300_000) return;
    const dedup = `card:${event.token ?? `${sourceId}:${sender}:${payload}`}`;
    if (this.#seen.has(dedup)) return;
    this.#seen.set(dedup, Date.now());
    if (this.#seen.size > 10_000) this.#seen.delete(this.#seen.keys().next().value!);
    const conversation = source.conversation;
    void this.publishEvent('message.receive', {
      event,
      conversation, message: { conversation, id: dedup }, content: '',
      segments: [{ type: 'action', data: { payload } }], sender: { id: sender }, endpointId: this.config.id,
      metadata: Object.freeze({ eventType: 'card.action.trigger', sourceMessageId: sourceId }),
    }).catch(() => this.#logger.warn('lark_card_action_receive_failed'));
  }

  admitPlatform(name: string, event: unknown): void {
    if (!this.#open) return;
    void this.receiveInboundCallback(() => this.publishPlatform(name, event)).catch((error) => {
      this.#logger.warn(formatCompact({
        op: 'lark_platform_event_failed',
        event: name,
        error: error instanceof Error ? error.message : String(error),
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
      const token = await this.#ensureAccessToken();
      const buf = await readFile(filePath);
      const form = new FormData();
      form.append('file', new Blob([buf]), basename(filePath));
      form.append('file_type', fileType);
      const url = `${this.#options.config.apiBaseUrl}/im/v1/files`;
      const response = await this.#fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
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
    { params = {}, signal }: EndpointManagementRequest & { readonly params?: Record<string, string | number> } = {},
  ): Promise<Record<string, unknown>[]> {
    const items: Record<string, unknown>[] = [];
    let pageToken = '';
    do {
      const data = await this.#request(path, {
        method: 'GET',
        signal,
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
      signal?: AbortSignal;
    } = {},
  ): Promise<LarkApiResponse> {
    const operation = createEndpointOperation(options);
    // TokenManager refresh is shared by the account; cancel this waiter, not that shared refresh.
    const token = await operation.prepare(() => this.#ensureAccessToken());
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
        Authorization: `Bearer ${token}`,
      },
      body: body && method !== 'GET' ? JSON.stringify(body) : undefined,
      signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(OUTBOUND_TIMEOUT_MS)]) : AbortSignal.timeout(OUTBOUND_TIMEOUT_MS),
    });
    const data = await response.json().catch(() => undefined) as LarkApiResponse | undefined;
    const platformCode = typeof data?.code === 'number' && Number.isFinite(data.code) ? data.code : undefined;
    if (!response.ok) {
      const rejected = response.status >= 400 && response.status < 500 && response.status !== 408;
      throw new LarkRequestError(response.status, platformCode, rejected);
    }
    if (platformCode === undefined) throw new LarkRequestError(response.status, undefined, false);
    if (platformCode !== 0) throw new LarkRequestError(response.status, platformCode, true);
    return data!;
  }

  async #ensureAccessToken(): Promise<string> {
    const token = await this.tokenManager.getTenantAccessToken();
    if (typeof token !== 'string' || !token) throw new Error('Lark SDK returned no tenant token');
    return token;
  }
  async #refreshAccessToken(): Promise<void> { await this.#ensureAccessToken(); }

}

function requireMessageId(value: unknown): string {
  if (typeof value === 'string' && value.trim().length > 0) return value;
  throw new EndpointDeliveryError('delivery_unconfirmed', 'Platform did not return a real message ID', 'unknown');
}

/** Carries only safe numerical diagnostics, never response bodies or credentials. */
class LarkRequestError extends EndpointDeliveryError {
  readonly status: number;
  readonly platformCode: number | undefined;
  constructor(status: number, platformCode: number | undefined, rejected: boolean) {
    super(rejected ? 'platform_rejected' : 'delivery_unconfirmed',
      `Lark request failed (status=${status}${platformCode === undefined ? '' : `, code=${platformCode}`})`,
      rejected ? 'rejected' : 'unknown');
    this.status = status;
    this.platformCode = platformCode;
  }
}

export type LarkClientEventMap = Record<string, import('./protocol.js').LarkEventBody>;
