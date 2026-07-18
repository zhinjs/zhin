/**
 * WeChatMpEndpoint — lifecycle, outbound, admit, access token refresh.
 */
import axios from 'axios';
import type { EndpointInstance } from '@zhin.js/adapter';
import type { MessageGateway } from '@zhin.js/core/runtime';
import type { HttpHost, HttpRouteRegistration } from '@zhin.js/host-http';
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { CapabilityId } from '@zhin.js/plugin-runtime';
import {
  extractOutboundText,
  formatCustomerServiceBody,
  formatInboundContent,
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
  #open = false;
  #started = false;

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
      id: msg.MsgId || `${msg.CreateTime}`,
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
    if (!this.#accessToken) await this.#refreshAccessToken();
    const url = `https://api.weixin.qq.com/cgi-bin/message/custom/send?access_token=${this.#accessToken}`;
    const messageData = formatCustomerServiceBody(target, payload);
    const response = await this.#fetch(url, { method: 'POST', body: messageData });
    const result = response.data as WeChatAPIResponse;
    if (result.errcode && result.errcode !== 0) {
      throw new Error(`WeChat API error: ${result.errcode} - ${result.errmsg}`);
    }
    logger.debug(formatCompact({ op: 'wechat_mp_send', target, messageId: result.msgid }));
    return result.msgid?.toString() || `cs_${Date.now()}`;
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
