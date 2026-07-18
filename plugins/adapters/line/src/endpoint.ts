/**
 * LineEndpoint — lifecycle, outbound, admit, OpenAPI helpers for agent tools.
 */
import type { EndpointInstance } from '@zhin.js/adapter';
import type { MessageGateway } from '@zhin.js/core/runtime';
import type { HttpHost, HttpRouteRegistration } from '@zhin.js/host-http';
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { CapabilityId } from '@zhin.js/plugin-runtime';
import { registerLineAgentEndpoint } from './line-agent-deps.js';
import {
  formatInboundContent,
  formatOutboundMessages,
  generateMessageId,
  isMessageEvent,
  isValidLineRecipientId,
  resolveChannel,
  type LineApiResponse,
  type LineEvent,
  type ResolvedLineConfig,
} from './protocol.js';
import { registerLineWebhookRoutes } from './webhook.js';

const logger = getLogger('line');

export type LineFetch = (
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

export interface LineEndpointOptions {
  readonly id: CapabilityId;
  readonly gateway: MessageGateway;
  readonly http: HttpHost;
  readonly config: ResolvedLineConfig;
  readonly fetch?: LineFetch;
}

export class LineEndpoint implements EndpointInstance {
  readonly #options: LineEndpointOptions;
  readonly #fetch: LineFetch;
  #routeReleases: HttpRouteRegistration[] = [];
  #replyTokenCache = new Map<string, string>();
  #open = false;
  #started = false;
  #unregisterAgent?: () => void;

  constructor(options: LineEndpointOptions) {
    this.#options = options;
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  /** Used by webhook handler. */
  get isOpen(): boolean {
    return this.#open;
  }

  get config(): ResolvedLineConfig {
    return this.#options.config;
  }

  getApiConfig(): { accessToken: string; apiBaseUrl: string } {
    return {
      accessToken: this.#options.config.channelAccessToken,
      apiBaseUrl: this.#options.config.apiBaseUrl,
    };
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    try {
      this.#unregisterAgent = registerLineAgentEndpoint(this.#options.config.name, this);
      this.#routeReleases.push(...registerLineWebhookRoutes(this.#options.http, this));
      logger.debug(formatCompact({
        endpoint: this.#options.config.name,
        op: 'webhook',
        path: this.#options.config.webhookPath,
      }));
    } catch (error) {
      await this.stop();
      logger.error('Failed to connect LINE endpoint:', error);
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
    this.#replyTokenCache.clear();
    for (const release of this.#routeReleases.splice(0)) release();
    this.#unregisterAgent?.();
    this.#unregisterAgent = undefined;
    this.#started = false;
    logger.debug(formatCompact({ op: 'disconnect', endpoint: this.#options.config.name }));
  }

  async send({ target, payload }: { readonly target: string; readonly payload: unknown }): Promise<string> {
    const messages = formatOutboundMessages(payload);
    if (messages.length === 0) {
      throw new Error('No valid LINE messages to send');
    }

    const replyToken = this.#replyTokenCache.get(target);
    if (replyToken) {
      this.#replyTokenCache.delete(target);
      return this.#replyMessage(replyToken, messages);
    }

    if (!isValidLineRecipientId(target)) {
      throw new Error(
        `Invalid LINE recipient ID "${target}": must start with U (user), G (group), or R (room)`,
      );
    }
    return this.#pushMessage(target, messages);
  }

  /** Test / internal: admit a parsed event when open (non-webhook path). */
  admit(event: LineEvent): void {
    if (!this.#open) return;
    const { channelId } = resolveChannel(event.source);
    if ('replyToken' in event && typeof event.replyToken === 'string') {
      this.#replyTokenCache.set(channelId, event.replyToken);
    }
    void this.#options.gateway.receive({
      adapter: this.#options.id,
      target: channelId,
      content: formatInboundContent(event),
      sender: event.source.userId || channelId,
      id: generateMessageId(event),
      metadata: Object.freeze({
        eventType: event.type,
        sourceType: event.source.type,
        endpoint: this.#options.config.name,
        timestamp: event.timestamp,
        ...(isMessageEvent(event) ? { messageType: event.message.type } : {}),
      }),
    }).catch((err) => {
      logger.warn(formatCompact({
        op: 'line_gateway_receive_failed',
        target: channelId,
        error: err instanceof Error ? err.message : String(err),
      }));
    });
  }

  async #replyMessage(
    replyToken: string,
    messages: ReturnType<typeof formatOutboundMessages>,
  ): Promise<string> {
    const url = `${this.#options.config.apiBaseUrl}/v2/bot/message/reply`;
    const response = await this.#fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.#options.config.channelAccessToken}`,
      },
      body: JSON.stringify({ replyToken, messages }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LINE Reply API error ${response.status}: ${errorText}`);
    }
    const result = await response.json() as LineApiResponse;
    return result.sentMessages?.[0]?.id || `reply-${Date.now()}`;
  }

  async #pushMessage(
    to: string,
    messages: ReturnType<typeof formatOutboundMessages>,
  ): Promise<string> {
    const url = `${this.#options.config.apiBaseUrl}/v2/bot/message/push`;
    const response = await this.#fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.#options.config.channelAccessToken}`,
      },
      body: JSON.stringify({ to, messages }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LINE Push API error ${response.status}: ${errorText}`);
    }
    const result = await response.json() as LineApiResponse;
    return result.sentMessages?.[0]?.id || `push-${Date.now()}`;
  }
}
