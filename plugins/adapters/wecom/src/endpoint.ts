/**
 * WecomEndpoint — lifecycle, outbound send, inbound admit, OpenAPI helpers for agent tools.
 */
import type { EndpointInstance } from '@zhin.js/adapter';
import type { MessageGateway } from '@zhin.js/core/runtime';
import type { HttpHost, HttpRouteRegistration } from '@zhin.js/host-http';
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { CapabilityId } from '@zhin.js/plugin-runtime';
import { registerWecomAgentEndpoint } from './wecom-agent-deps.js';
import {
  buildSendRequestBody,
  formatInboundContent,
  formatOutboundBody,
  resolveChatType,
  type AccessToken,
  type ResolvedWecomConfig,
  type WecomApiResponse,
  type WecomMessage,
} from './protocol.js';
import { registerWecomWebhookRoutes } from './webhook.js';

const logger = getLogger('wecom');

export type WecomFetch = (
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

export interface WecomEndpointOptions {
  readonly id: CapabilityId;
  readonly gateway: MessageGateway;
  readonly http: HttpHost;
  readonly config: ResolvedWecomConfig;
  readonly fetch?: WecomFetch;
}

export class WecomEndpoint implements EndpointInstance {
  readonly #options: WecomEndpointOptions;
  readonly #fetch: WecomFetch;
  #routeReleases: HttpRouteRegistration[] = [];
  #accessToken: AccessToken = { access_token: '', expires_in: 0, timestamp: 0 };
  #refreshPromise: Promise<string> | null = null;
  #open = false;
  #started = false;
  #unregisterAgent?: () => void;

  constructor(options: WecomEndpointOptions) {
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
      this.#unregisterAgent = registerWecomAgentEndpoint(this.#options.config.name, this);
      this.#routeReleases.push(...registerWecomWebhookRoutes(this.#options.http, this));
      logger.debug(formatCompact({
        endpoint: this.#options.config.name,
        op: 'webhook',
        path: this.#options.config.webhookPath,
      }));
    } catch (error) {
      await this.stop();
      logger.error('Failed to connect WeCom endpoint:', error);
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
    const body = buildSendRequestBody(
      target,
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
    logger.debug(formatCompact({ op: 'send', endpoint: this.#options.config.name, to: target }));
    return (data.msgid as string) || `${Date.now()}`;
  }

  /** Test / internal: admit a parsed message when open (non-webhook path). */
  admit(msg: WecomMessage): void {
    if (!this.#open) return;
    const chatType = resolveChatType(msg.FromUserName);
    void this.#options.gateway.receive({
      adapter: this.#options.id,
      target: msg.FromUserName,
      content: formatInboundContent(msg),
      sender: msg.FromUserName,
      id: msg.MsgId || `${msg.CreateTime}`,
      metadata: Object.freeze({
        msgType: msg.MsgType,
        event: msg.Event,
        chatType,
        endpoint: this.#options.config.name,
        toUserName: msg.ToUserName,
        agentId: msg.AgentID,
      }),
    }).catch((err) => {
      logger.warn(formatCompact({
        op: 'wecom_gateway_receive_failed',
        target: msg.FromUserName,
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
      logger.error('Failed to get user info:', error);
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
      logger.error('Failed to get department users:', error);
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
      logger.error('Failed to get department list:', error);
      return [];
    }
  }

  async sendTextMessage(userId: string, content: string): Promise<boolean> {
    try {
      await this.send({ target: userId, payload: content });
      return true;
    } catch (error) {
      logger.error('Failed to send text message:', error);
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
      logger.debug('Access token refreshed successfully');
      return;
    }
    throw new Error(`Failed to get access token: ${data.errmsg} (${data.errcode})`);
  }
}
