import { DingTalkCards, type DingTalkCardCallback } from './cards.js';
import { DingTalkStream, type DingTalkStreamSocketFactory } from './stream.js';
import { EndpointDeliveryError } from '@zhin.js/im-contract';
/**
 * DingTalkEndpoint — lifecycle, outbound, admit, OpenAPI helpers for agent tools.
 */
import { Endpoint, type EndpointSendRequest } from 'zhin.js/adapter';
import type { HttpHost, HttpRouteRegistration } from '@zhin.js/host-http';
import { formatCompact, getAdapterLogger } from '@zhin.js/logger';
import type { CapabilityId } from 'zhin.js';
import { normalizeDingtalkSenderForPermit } from './platform-permit.js';
import {
  dingtalkInboundConversation,
  formatInboundContent,
  formatOutboundBody,
  generateMessageId,
  isDingtalkBotMentioned,
  resolveChatType,
  resolveSender,
  type AccessToken,
  type DingTalkApiResponse,
  type DingTalkEvent,
  type DingTalkMessage,
  type DingTalkSendBody,
  type ResolvedDingTalkConfig,
} from './protocol.js';
import { registerDingTalkWebhookRoutes } from './webhook.js';

export type DingTalkFetch = (
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

export interface DingTalkEndpointOptions {
  readonly id: CapabilityId;
  readonly http?: HttpHost;
  readonly createStreamSocket?: DingTalkStreamSocketFactory;
  readonly config: ResolvedDingTalkConfig;
  readonly fetch?: DingTalkFetch;
}

export interface DingTalkClientApi {
  getUserInfo(userId: string): Promise<unknown>;
  getDepartmentUsers(deptId: number): Promise<unknown[]>;
  sendWorkNotice(userIdList: string[], content: unknown): Promise<boolean>;
  getDepartmentList(deptId?: number): Promise<unknown[]>;
  getDepartmentInfo(deptId: number): Promise<unknown>;
  createChat(name: string, ownerUserId: string, userIdList: string[]): Promise<string | null>;
  getChatInfo(chatId: string): Promise<unknown>;
  updateChat(chatId: string, options: {
    name?: string;
    owner?: string;
    add_useridlist?: string[];
    del_useridlist?: string[];
  }): Promise<boolean>;
}

/** SDK-like DingTalk OpenAPI surface available on every Endpoint event. */
export class DingTalkClient implements DingTalkClientApi {
  constructor(readonly api: DingTalkClientApi) {}
  getUserInfo = (userId: string) => this.api.getUserInfo(userId);
  getDepartmentUsers = (deptId: number) => this.api.getDepartmentUsers(deptId);
  sendWorkNotice = (userIds: string[], content: unknown) =>
    this.api.sendWorkNotice(userIds, content);
  getDepartmentList = (deptId?: number) => this.api.getDepartmentList(deptId);
  getDepartmentInfo = (deptId: number) => this.api.getDepartmentInfo(deptId);
  createChat = (name: string, owner: string, users: string[]) =>
    this.api.createChat(name, owner, users);
  getChatInfo = (chatId: string) => this.api.getChatInfo(chatId);
  updateChat = (chatId: string, options: Parameters<DingTalkClientApi['updateChat']>[1]) =>
    this.api.updateChat(chatId, options);
}

/**
 * 钉钉机器人（webhook/stream 模式）无常规群列表 API——机器人不持有
 * 「我所在的群」枚举面，仅能收发消息；
 * 因此本 endpoint 不暴露 EndpointManagement（Console 社交面 RPC 对该平台保持未接线）。
 */
export class DingTalkEndpoint extends Endpoint<DingTalkClient> {
  readonly client = new DingTalkClient({
    getUserInfo: (userId) => this.#getUserInfo(userId),
    getDepartmentUsers: (deptId) => this.#getDepartmentUsers(deptId),
    sendWorkNotice: (userIds, content) => this.#sendWorkNotice(userIds, content),
    getDepartmentList: (deptId) => this.#getDepartmentList(deptId),
    getDepartmentInfo: (deptId) => this.#getDepartmentInfo(deptId),
    createChat: (name, owner, users) => this.#createChat(name, owner, users),
    getChatInfo: (chatId) => this.#getChatInfo(chatId),
    updateChat: (chatId, options) => this.#updateChat(chatId, options),
  });
  readonly #logger!: ReturnType<typeof getAdapterLogger>;

  readonly #options: DingTalkEndpointOptions;
  readonly #fetch: DingTalkFetch;
  #routeReleases: HttpRouteRegistration[] = [];
  #accessToken: AccessToken = { token: '', expires_in: 0, timestamp: 0 };
  #refreshPromise: Promise<string> | null = null;
  #sessionWebhooks = new Map<string, { url: string; expiresAt: number }>();
  #stream?: DingTalkStream;
  readonly #cards = new DingTalkCards();
  #open = false;
  #started = false;

  constructor(options: DingTalkEndpointOptions) {
    super();
    this.#logger = getAdapterLogger('dingtalk', options.config.id);
    this.#options = options;
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  get transportState() { return this.#stream?.lifecycle.state ?? (this.#started ? 'open' : 'stopped'); }

  /** Used by webhook handler. */
  get isOpen(): boolean {
    return this.#open;
  }

  get config(): ResolvedDingTalkConfig {
    return this.#options.config;
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    try {
      if (this.#options.config.mode === 'stream') {
        this.#stream = new DingTalkStream(this.config, this.#fetch, (event) => this.admit(event), () => this.#open, this.#options.createStreamSocket, (event, id) => this.admitCard(event, id));
        await this.#stream.start();
        return;
      }
      await this.#refreshAccessToken();
      this.#routeReleases.push(...registerDingTalkWebhookRoutes(this.#options.http!, this));
      this.#logger.debug(formatCompact({
        endpoint: this.#options.config.id,
        op: 'webhook',
        path: this.#options.config.webhookPath,
      }));
    } catch (error) {
      await this.stop();
      this.#logger.error('Failed to connect DingTalk endpoint:', error);
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
    await this.#stream?.stop();
    this.#sessionWebhooks.clear();
    this.#cards.clear();
    for (const release of this.#routeReleases.splice(0)) release();
    this.#started = false;
    this.#logger.debug(formatCompact({ op: 'disconnect' }));
  }

  async send({ conversation, payload }: EndpointSendRequest): Promise<string> {
    try {
      const card = this.#cards.prepare(this.config, conversation, payload);
      if (card) {
        let stage = 'token';
        let httpStatus: number | undefined;
        let platformCode: string | number | undefined;
        try {
          try { await this.#ensureAccessToken(); } catch (cause) { throw new EndpointDeliveryError('token_unavailable', 'DingTalk card token unavailable', 'not_sent', { cause }); }
          stage = 'request';
          const response = await this.#fetch('https://api.dingtalk.com/v1.0/card/instances/createAndDeliver', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-acs-dingtalk-access-token': this.#accessToken.token }, body: JSON.stringify(card.body), signal: AbortSignal.timeout(30_000) });
          httpStatus = response.status;
          stage = 'response';
          let data: unknown;
          try { data = await response.json(); } catch {
            if (response.ok) throw new EndpointDeliveryError('invalid_response', 'DingTalk card response could not be parsed', 'unknown');
          }
          if (data && typeof data === 'object') {
            const code = (data as { code?: unknown; errcode?: unknown }).code ?? (data as { errcode?: unknown }).errcode;
            // Only bounded protocol codes; never log URLs, messages, response bodies or credentials.
            if (typeof code === 'number' && Number.isFinite(code)) platformCode = code;
            else if (typeof code === 'string' && /^[a-zA-Z][a-zA-Z0-9_.-]{0,95}$/.test(code)
              && ![this.#accessToken.token, this.config.appSecret, this.config.appKey].some(secret => secret && code.includes(secret))) platformCode = code;
          }
          if (!response.ok) throw new EndpointDeliveryError('http_error', `DingTalk card HTTP ${response.status}`, response.status >= 400 && response.status < 500 ? 'rejected' : 'unknown');
          stage = 'delivery';
          return this.#cards.confirm(card, data);
        } catch (error) {
          this.#logger.warn(formatCompact({ op: 'dingtalk_card_delivery_failed', stage, httpStatus, platformCode,
            code: error instanceof EndpointDeliveryError ? error.code : 'delivery_unconfirmed' }));
          throw error;
        }
      }
      const content = formatOutboundBody(payload);
      const session = this.#sessionWebhooks.get(conversation.id);
      const sessionWebhook = session && session.expiresAt > Date.now() ? session.url : undefined;
      if (session && !sessionWebhook) this.#sessionWebhooks.delete(conversation.id);
      if (!sessionWebhook && this.config.mode === 'stream') {
        throw new EndpointDeliveryError('session_unavailable', 'DingTalk Stream send requires a current inbound session webhook', 'not_sent');
      }
      if (sessionWebhook) {
        const response = await this.#fetch(sessionWebhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify(content),
          signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) throw new EndpointDeliveryError('http_error', `DingTalk HTTP ${response.status}`, response.status >= 400 && response.status < 500 ? 'rejected' : 'unknown');
        const data = await response.json() as DingTalkApiResponse;
        if (typeof data.errcode === 'number' && data.errcode !== 0) {
          throw new EndpointDeliveryError('platform_rejected', `DingTalk session webhook rejected the outbound request (${data.errcode})`, 'rejected');
        }
        this.#logger.debug(formatCompact({
          op: 'send',
          endpoint: this.#options.config.id,
          via: 'sessionWebhook',
          to: conversation.id,
        }));
        if (data.errcode !== 0) throw new EndpointDeliveryError('delivery_unconfirmed', 'Malformed platform response', 'unknown');
        return requireMessageId(data.msgId);
      }

      const body: DingTalkSendBody = {
        ...content,
        ...(this.#options.config.robotCode
          ? { robotCode: this.#options.config.robotCode }
          : {}),
      };
      const data = await this.#request('/robot/send', {
        method: 'POST',
        body: body as unknown as Record<string, unknown>,
      });
      if (typeof data.errcode === 'number' && data.errcode !== 0) {
        throw new EndpointDeliveryError('platform_rejected', `DingTalk rejected the outbound request (${data.errcode})`, 'rejected');
      }
      this.#logger.debug(formatCompact({ op: 'send', to: conversation.id }));
      if (data.errcode !== 0) throw new EndpointDeliveryError('delivery_unconfirmed', 'Malformed platform response', 'unknown');
      return requireMessageId(data.msgId);
    } catch (error) {
      if (error instanceof EndpointDeliveryError) throw error;
      throw new EndpointDeliveryError('delivery_unconfirmed', 'Outbound request outcome is unknown', 'unknown', { cause: error });
    }
  }

  async admitCard(event: DingTalkCardCallback, id: string): Promise<void> {
    if (!this.#open) throw new Error('DingTalk endpoint is closed');
    const action = this.#cards.resolve(event);
    await this.emitAccepted('message.receive', {
      conversation: action.conversation, message: { conversation: action.conversation, id },
      content: `[action: ${action.payload}]`, segments: [{ type: 'action', data: { id, payload: action.payload, sourceMessageId: action.sourceMessageId } }],
      sender: { id: action.senderId }, endpointId: this.config.id,
      metadata: Object.freeze({ eventType: 'card_callback', sourceMessageId: action.sourceMessageId }),
    });
  }

  /** Test / internal: admit a parsed event when open (non-webhook path). */
  async admit(event: DingTalkEvent | DingTalkMessage): Promise<void> {
    if (!this.#open) return;
    this.#emitPlatformEvent(event.msgtype || 'event', event);
    if (event.sessionWebhook && event.conversationId) {
      const expiresAt = Number.isFinite(event.sessionWebhookExpiredTime) ? event.sessionWebhookExpiredTime! : Date.now() + 300_000;
      this.#sessionWebhooks.delete(event.conversationId);
      if (expiresAt > Date.now()) this.#sessionWebhooks.set(event.conversationId, { url: event.sessionWebhook, expiresAt });
      while (this.#sessionWebhooks.size > 1024) this.#sessionWebhooks.delete(this.#sessionWebhooks.keys().next().value!);
    }
    const conversation = dingtalkInboundConversation(String(this.#options.id), event);
    this.#cards.remember(conversation, event);
    const chatType = resolveChatType(event.conversationType);
    const permit = normalizeDingtalkSenderForPermit({ isAdmin: event.isAdmin === true });
    await this.emitAccepted('message.receive', {
      conversation,
      message: { conversation, id: generateMessageId(event) },
      content: formatInboundContent(event),
      sender: {
        id: resolveSender(event),
        name: event.senderNick || undefined,
        ...(permit.role ? { roles: [permit.role] } : {}),
      },
      endpointId: this.#options.config.id,
      ...(isDingtalkBotMentioned(event, this.#options.config.robotCode) ? { mentioned: true } : {}),
      metadata: Object.freeze({
        msgtype: event.msgtype,
        chatType,
        senderNick: event.senderNick,
        role: permit.role,
        permissions: permit.permissions,
        conversationType: event.conversationType,
      }),
    }).catch((err) => {
      if (this.config.mode === 'stream') throw err;
      this.#logger.warn(formatCompact({
        op: 'dingtalk_gateway_receive_failed',
        conversationId: conversation.id,
        error: err instanceof Error ? err.message : String(err),
      }));
    });
  }

  #emitPlatformEvent(name: string, event: unknown): void {
    void this.emitPlatform(name, event).catch((error) => {
      this.#logger.warn(formatCompact({
        op: 'dingtalk_platform_event_failed',
        event: name,
        error: error instanceof Error ? error.message : String(error),
      }));
    });
  }

  async #getUserInfo(userId: string): Promise<unknown> {
    try {
      const data = await this.#request('/topapi/v2/user/get', {
        method: 'POST',
        body: { userid: userId },
      });
      if (data.errcode === 0) return data.result;
      throw new Error(`Failed to get user info: ${data.errmsg}`);
    } catch (error) {
      this.#logger.error('Failed to get user info:', error);
      return null;
    }
  }

  async #getDepartmentUsers(deptId: number): Promise<unknown[]> {
    try {
      const data = await this.#request('/topapi/user/listid', {
        method: 'POST',
        body: { dept_id: deptId },
      });
      if (data.errcode === 0) {
        const result = data.result as { userid_list?: unknown[] } | undefined;
        return result?.userid_list || [];
      }
      throw new Error(`Failed to get department users: ${data.errmsg}`);
    } catch (error) {
      this.#logger.error('Failed to get department users:', error);
      return [];
    }
  }

  async #sendWorkNotice(userIdList: string[], content: unknown): Promise<boolean> {
    try {
      const data = await this.#request('/topapi/message/corpconversation/asyncsend_v2', {
        method: 'POST',
        body: {
          agent_id: this.#options.config.robotCode,
          userid_list: userIdList.join(','),
          msg: content,
        },
      });
      if (data.errcode === 0) return true;
      throw new Error(`Failed to send work notice: ${data.errmsg}`);
    } catch (error) {
      this.#logger.error('Failed to send work notice:', error);
      return false;
    }
  }

  async #getDepartmentList(deptId: number = 1): Promise<unknown[]> {
    try {
      const data = await this.#request('/topapi/v2/department/listsub', {
        method: 'POST',
        body: { dept_id: deptId },
      });
      if (data.errcode === 0) return (data.result as unknown[]) || [];
      throw new Error(`Failed to get department list: ${data.errmsg}`);
    } catch (error) {
      this.#logger.error('Failed to get department list:', error);
      return [];
    }
  }

  async #getDepartmentInfo(deptId: number): Promise<unknown> {
    try {
      const data = await this.#request('/topapi/v2/department/get', {
        method: 'POST',
        body: { dept_id: deptId },
      });
      if (data.errcode === 0) return data.result;
      throw new Error(`Failed to get department info: ${data.errmsg}`);
    } catch (error) {
      this.#logger.error('Failed to get department info:', error);
      return null;
    }
  }

  async #createChat(
    name: string,
    ownerUserId: string,
    userIdList: string[],
  ): Promise<string | null> {
    try {
      const data = await this.#request('/topapi/chat/create', {
        method: 'POST',
        body: { name, owner: ownerUserId, useridlist: userIdList },
      });
      if (data.errcode === 0) return (data.chatid as string) || null;
      throw new Error(`Failed to create chat: ${data.errmsg}`);
    } catch (error) {
      this.#logger.error('Failed to create chat:', error);
      return null;
    }
  }

  async #getChatInfo(chatId: string): Promise<unknown> {
    try {
      const data = await this.#request('/topapi/chat/get', {
        method: 'POST',
        body: { chatid: chatId },
      });
      if (data.errcode === 0) return data.chat_info;
      throw new Error(`Failed to get chat info: ${data.errmsg}`);
    } catch (error) {
      this.#logger.error('Failed to get chat info:', error);
      return null;
    }
  }

  async #updateChat(
    chatId: string,
    options: {
      name?: string;
      owner?: string;
      add_useridlist?: string[];
      del_useridlist?: string[];
    },
  ): Promise<boolean> {
    try {
      const data = await this.#request('/topapi/chat/update', {
        method: 'POST',
        body: { chatid: chatId, ...options },
      });
      if (data.errcode === 0) return true;
      throw new Error(`Failed to update chat: ${data.errmsg}`);
    } catch (error) {
      this.#logger.error('Failed to update chat:', error);
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
  ): Promise<DingTalkApiResponse> {
    await this.#ensureAccessToken();
    const { method = 'GET', params = {}, body } = options;
    const urlParams = new URLSearchParams({
      ...Object.fromEntries(
        Object.entries(params).map(([key, value]) => [key, String(value)]),
      ),
      access_token: this.#accessToken.token,
    });
    const url = `${this.#options.config.apiBaseUrl}${path}?${urlParams.toString()}`;
    const response = await this.#fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: body && method === 'POST' ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new EndpointDeliveryError('http_error', `DingTalk HTTP ${response.status}`, response.status >= 400 && response.status < 500 ? 'rejected' : 'unknown');
    }
    return await response.json() as DingTalkApiResponse;
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
    const { appKey, appSecret, apiBaseUrl } = this.#options.config;
    const params = new URLSearchParams({ appkey: appKey, appsecret: appSecret });
    const url = `${apiBaseUrl}/gettoken?${params.toString()}`;
    const response = await this.#fetch(url);
    const data = await response.json() as DingTalkApiResponse;
    if (data.errcode === 0 && data.access_token) {
      this.#accessToken = {
        token: data.access_token,
        expires_in: data.expires_in ?? 7200,
        timestamp: Date.now(),
      };
      this.#logger.debug('Access token refreshed successfully');
      return;
    }
    throw new Error(`Failed to get access token: ${data.errmsg} (${data.errcode})`);
  }
}

function requireMessageId(value: unknown): string {
  if (typeof value === 'string' && value.trim().length > 0) return value;
  throw new EndpointDeliveryError('delivery_unconfirmed', 'Platform did not return a real message ID', 'unknown');
}
