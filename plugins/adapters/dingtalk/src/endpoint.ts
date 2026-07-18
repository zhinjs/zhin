/**
 * DingTalkEndpoint — lifecycle, outbound, admit, OpenAPI helpers for agent tools.
 */
import type { EndpointInstance } from '@zhin.js/adapter';
import type { MessageGateway } from '@zhin.js/core/runtime';
import type { HttpHost, HttpRouteRegistration } from '@zhin.js/host-http';
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { CapabilityId } from '@zhin.js/plugin-runtime';
import { registerDingtalkAgentEndpoint } from './dingtalk-agent-deps.js';
import { normalizeDingtalkSenderForPermit } from './platform-permit.js';
import {
  formatInboundContent,
  formatOutboundBody,
  generateMessageId,
  resolveChatType,
  resolveSender,
  resolveTarget,
  type AccessToken,
  type DingTalkApiResponse,
  type DingTalkEvent,
  type DingTalkMessage,
  type DingTalkSendBody,
  type ResolvedDingTalkConfig,
} from './protocol.js';
import { registerDingTalkWebhookRoutes } from './webhook.js';

const logger = getLogger('dingtalk');

export type DingTalkFetch = (
  url: string,
  init?: {
    readonly method?: string;
    readonly headers?: Record<string, string>;
    readonly body?: string;
  },
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}>;

export interface DingTalkEndpointOptions {
  readonly id: CapabilityId;
  readonly gateway: MessageGateway;
  readonly http: HttpHost;
  readonly config: ResolvedDingTalkConfig;
  readonly fetch?: DingTalkFetch;
}

export class DingTalkEndpoint implements EndpointInstance {
  readonly #options: DingTalkEndpointOptions;
  readonly #fetch: DingTalkFetch;
  #routeReleases: HttpRouteRegistration[] = [];
  #accessToken: AccessToken = { token: '', expires_in: 0, timestamp: 0 };
  #refreshPromise: Promise<string> | null = null;
  #sessionWebhooks = new Map<string, string>();
  #open = false;
  #started = false;
  #unregisterAgent?: () => void;

  constructor(options: DingTalkEndpointOptions) {
    this.#options = options;
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

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
      await this.#refreshAccessToken();
      this.#unregisterAgent = registerDingtalkAgentEndpoint(this.#options.config.name, this);
      this.#routeReleases.push(...registerDingTalkWebhookRoutes(this.#options.http, this));
      logger.debug(formatCompact({
        endpoint: this.#options.config.name,
        op: 'webhook',
        path: this.#options.config.webhookPath,
      }));
    } catch (error) {
      await this.stop();
      logger.error('Failed to connect DingTalk endpoint:', error);
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
    this.#sessionWebhooks.clear();
    for (const release of this.#routeReleases.splice(0)) release();
    this.#unregisterAgent?.();
    this.#unregisterAgent = undefined;
    this.#started = false;
    logger.debug(formatCompact({ op: 'disconnect', endpoint: this.#options.config.name }));
  }

  async send({ target, payload }: { readonly target: string; readonly payload: unknown }): Promise<string> {
    const content = formatOutboundBody(payload);
    const sessionWebhook = this.#sessionWebhooks.get(target);
    if (sessionWebhook) {
      const response = await this.#fetch(sessionWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(content),
      });
      const data = await response.json() as DingTalkApiResponse;
      if (data.errcode !== 0) {
        throw new Error(`Failed to send message via session webhook: ${data.errmsg}`);
      }
      logger.debug(formatCompact({
        op: 'send',
        endpoint: this.#options.config.name,
        via: 'sessionWebhook',
        to: target,
      }));
      return (data.msgId as string) || `${Date.now()}`;
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
    if (data.errcode !== 0) {
      throw new Error(`Failed to send message: ${data.errmsg}`);
    }
    logger.debug(formatCompact({ op: 'send', endpoint: this.#options.config.name, to: target }));
    return (data.msgId as string) || `${Date.now()}`;
  }

  /** Test / internal: admit a parsed event when open (non-webhook path). */
  admit(event: DingTalkEvent | DingTalkMessage): void {
    if (!this.#open) return;
    if (event.sessionWebhook && event.conversationId) {
      this.#sessionWebhooks.set(event.conversationId, event.sessionWebhook);
    }
    const target = resolveTarget(event);
    const chatType = resolveChatType(event.conversationType);
    const permit = normalizeDingtalkSenderForPermit({ isAdmin: event.isAdmin === true });
    void this.#options.gateway.receive({
      adapter: this.#options.id,
      target,
      content: formatInboundContent(event),
      sender: resolveSender(event),
      id: generateMessageId(event),
      metadata: Object.freeze({
        msgtype: event.msgtype,
        chatType,
        endpoint: this.#options.config.name,
        senderNick: event.senderNick,
        role: permit.role,
        permissions: permit.permissions,
        conversationType: event.conversationType,
      }),
    }).catch((err) => {
      logger.warn(formatCompact({
        op: 'dingtalk_gateway_receive_failed',
        target,
        error: err instanceof Error ? err.message : String(err),
      }));
    });
  }

  async getUserInfo(userId: string): Promise<unknown> {
    try {
      const data = await this.#request('/topapi/v2/user/get', {
        method: 'POST',
        body: { userid: userId },
      });
      if (data.errcode === 0) return data.result;
      throw new Error(`Failed to get user info: ${data.errmsg}`);
    } catch (error) {
      logger.error('Failed to get user info:', error);
      return null;
    }
  }

  async getDepartmentUsers(deptId: number): Promise<unknown[]> {
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
      logger.error('Failed to get department users:', error);
      return [];
    }
  }

  async sendWorkNotice(userIdList: string[], content: unknown): Promise<boolean> {
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
      logger.error('Failed to send work notice:', error);
      return false;
    }
  }

  async getDepartmentList(deptId: number = 1): Promise<unknown[]> {
    try {
      const data = await this.#request('/topapi/v2/department/listsub', {
        method: 'POST',
        body: { dept_id: deptId },
      });
      if (data.errcode === 0) return (data.result as unknown[]) || [];
      throw new Error(`Failed to get department list: ${data.errmsg}`);
    } catch (error) {
      logger.error('Failed to get department list:', error);
      return [];
    }
  }

  async getDepartmentInfo(deptId: number): Promise<unknown> {
    try {
      const data = await this.#request('/topapi/v2/department/get', {
        method: 'POST',
        body: { dept_id: deptId },
      });
      if (data.errcode === 0) return data.result;
      throw new Error(`Failed to get department info: ${data.errmsg}`);
    } catch (error) {
      logger.error('Failed to get department info:', error);
      return null;
    }
  }

  async createChat(
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
      logger.error('Failed to create chat:', error);
      return null;
    }
  }

  async getChatInfo(chatId: string): Promise<unknown> {
    try {
      const data = await this.#request('/topapi/chat/get', {
        method: 'POST',
        body: { chatid: chatId },
      });
      if (data.errcode === 0) return data.chat_info;
      throw new Error(`Failed to get chat info: ${data.errmsg}`);
    } catch (error) {
      logger.error('Failed to get chat info:', error);
      return null;
    }
  }

  async updateChat(
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
      logger.error('Failed to update chat:', error);
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
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`DingTalk API error ${response.status}: ${text}`);
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
      logger.debug('Access token refreshed successfully');
      return;
    }
    throw new Error(`Failed to get access token: ${data.errmsg} (${data.errcode})`);
  }
}
