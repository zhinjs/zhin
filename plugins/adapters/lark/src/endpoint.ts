/**
 * LarkEndpoint — lifecycle, outbound, admit, OpenAPI helpers for agent tools.
 */
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { EndpointInstance } from '@zhin.js/adapter';
import type { MessageGateway } from '@zhin.js/core/runtime';
import type { HttpHost, HttpRouteRegistration } from '@zhin.js/host-http';
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { CapabilityId } from '@zhin.js/plugin-runtime';
import { registerLarkAgentEndpoint } from './lark-agent-deps.js';
import {
  formatInboundContent,
  formatOutboundBody,
  generateMessageId,
  resolveChatType,
  resolveSender,
  resolveTarget,
  type AccessToken,
  type LarkApiResponse,
  type LarkMessage,
  type ResolvedLarkConfig,
} from './protocol.js';
import { registerLarkWebhookRoutes } from './webhook.js';

const logger = getLogger('lark');

export type LarkFetch = (
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

export interface LarkEndpointOptions {
  readonly id: CapabilityId;
  readonly gateway: MessageGateway;
  readonly http: HttpHost;
  readonly config: ResolvedLarkConfig;
  readonly fetch?: LarkFetch;
}

export class LarkEndpoint implements EndpointInstance {
  readonly #options: LarkEndpointOptions;
  readonly #fetch: LarkFetch;
  #routeReleases: HttpRouteRegistration[] = [];
  #accessToken: AccessToken = { token: '', expires_in: 0, timestamp: 0 };
  #refreshPromise: Promise<string> | null = null;
  #open = false;
  #started = false;
  #unregisterAgent?: () => void;

  constructor(options: LarkEndpointOptions) {
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
      await this.#refreshAccessToken();
      this.#unregisterAgent = registerLarkAgentEndpoint(this.#options.config.name, this);
      this.#routeReleases.push(...registerLarkWebhookRoutes(this.#options.http, this));
      logger.debug(formatCompact({
        endpoint: this.#options.config.name,
        op: 'webhook',
        path: this.#options.config.webhookPath,
      }));
    } catch (error) {
      await this.stop();
      logger.error('Failed to connect Lark endpoint:', error);
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
    logger.debug(formatCompact({ op: 'disconnect', endpoint: this.#options.config.name }));
  }

  async send({ target, payload }: { readonly target: string; readonly payload: unknown }): Promise<string> {
    const content = formatOutboundBody(payload);
    const data = await this.#request('/im/v1/messages', {
      method: 'POST',
      params: { receive_id_type: 'chat_id' },
      body: {
        receive_id: target,
        msg_type: content.msg_type,
        content: content.content,
      },
    });
    if (data.code !== 0) {
      throw new Error(`Failed to send message: ${data.msg}`);
    }
    const messageId = (data.data?.message_id as string) || `${Date.now()}`;
    logger.debug(formatCompact({
      op: 'send',
      endpoint: this.#options.config.name,
      to: target,
      id: messageId,
    }));
    return messageId;
  }

  /** Test / internal: admit a parsed message when open (non-webhook path). */
  admit(msg: LarkMessage): void {
    if (!this.#open) return;
    const target = resolveTarget(msg);
    void this.#options.gateway.receive({
      adapter: this.#options.id,
      target,
      content: formatInboundContent(msg),
      sender: resolveSender(msg),
      id: generateMessageId(msg),
      metadata: Object.freeze({
        messageType: msg.message_type,
        chatType: resolveChatType(msg.chat_id),
        endpoint: this.#options.config.name,
      }),
    }).catch((err) => {
      logger.warn(formatCompact({
        op: 'lark_gateway_receive_failed',
        target,
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
      logger.error('Failed to get user info:', error);
      return null;
    }
  }

  async getChatInfo(chatId: string): Promise<unknown> {
    try {
      const data = await this.#request(`/im/v1/chats/${chatId}`, { method: 'GET' });
      return data.data ?? null;
    } catch (error) {
      logger.error('Failed to get chat info:', error);
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
      logger.error('Failed to upload file:', error);
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
      logger.error('Failed to create chat:', error);
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
      logger.error('Failed to update chat:', error);
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
      logger.error('Failed to add chat members:', error);
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
      logger.error('Failed to remove chat members:', error);
      return false;
    }
  }

  async getChatMembers(chatId: string): Promise<unknown[]> {
    try {
      const data = await this.#request(`/im/v1/chats/${chatId}/members`, { method: 'GET' });
      if (data.code === 0) return (data.data?.items as unknown[]) || [];
      throw new Error(`Failed to get members: ${data.msg}`);
    } catch (error) {
      logger.error('Failed to get chat members:', error);
      return [];
    }
  }

  async dissolveChat(chatId: string): Promise<boolean> {
    try {
      const data = await this.#request(`/im/v1/chats/${chatId}`, { method: 'DELETE' });
      if (data.code === 0) return true;
      throw new Error(`Failed to dissolve chat: ${data.msg}`);
    } catch (error) {
      logger.error('Failed to dissolve chat:', error);
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
      logger.error('Failed to set chat managers:', error);
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
      logger.error('Failed to remove chat managers:', error);
      return false;
    }
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
      logger.debug('Access token refreshed successfully');
      return;
    }
    throw new Error(`Failed to get access token: ${data.msg} (${data.code})`);
  }
}
