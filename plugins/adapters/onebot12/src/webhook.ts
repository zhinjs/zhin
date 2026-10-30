import { acceptHttpIngress } from 'imhelper';
/**
 * OneBot12 HTTP webhook endpoint — POST inbound + api_url outbound.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  createEndpointSpecification, endpointSpec,
  type Endpoint, type EndpointSpecification,
  createRecallEndpointControl,
  type EndpointControl,
  type EndpointManagement,
  type EndpointSendRequest,
} from 'zhin.js/adapter';
import type { HttpHost, HttpRouteRegistration } from '@zhin.js/host-http';
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { CapabilityId } from 'zhin.js';
import { createOneBot12EndpointManagement } from './endpoint-management.js';
import {
  buildSendMessageParams,
  matchesOneBot12Self,
  callOneBot12Action,
  formatInboundContent,
  formatOutboundSegments,
  isBotMentioned,
  isMessageEvent,
  onebot12InboundConversation,
  senderNickname,
  senderUserId,
  uploadOneBot12MediaSegments,
  type OneBot12Event,
  type OneBot12WebhookConfig,
} from './protocol.js';
import { receiveOneBot12SideEvent } from './side-event-dispatch.js';
import { createOneBot12ContentPort } from './content-port.js';
import { callOnebot12Client, onebot12ClientOptions, forwardOnebot12ClientEvents, Onebot12Client } from './client.js';
import { verifyOneBotAccessToken } from './wss-auth.js';

const logger = getLogger('onebot12');

export interface OneBot12WebhookEndpointOptions {
  readonly signal?: AbortSignal;
  readonly id: CapabilityId;
  readonly http: HttpHost;
  readonly config: OneBot12WebhookConfig;
  readonly callAction?: typeof callOneBot12Action;
}

export class OneBot12WebhookEndpoint extends Onebot12Client implements Endpoint {
  readonly [endpointSpec]: EndpointSpecification;
  #open = false;
  readonly #options: OneBot12WebhookEndpointOptions;
  readonly #management: EndpointManagement;
  readonly #control: EndpointControl = createRecallEndpointControl((id) => this.#recallMessage(id));
  readonly #content;
  readonly #callAction: typeof callOneBot12Action;
  #routeReleases: HttpRouteRegistration[] = [];
  #started = false;

  constructor(options: OneBot12WebhookEndpointOptions) {
    super(onebot12ClientOptions(options.config, (action, params) => this.#callApi(action, params)));
    this.#options = options;
    this.#callAction = options.callAction ?? callOneBot12Action;
    const callApi = (action: string, params?: Record<string, unknown>) => callOnebot12Client(this, action, params);
    this.#management = createOneBot12EndpointManagement({ callApi });
    this.#content = createOneBot12ContentPort(callApi);
    this[endpointSpec] = createEndpointSpecification(this, {
      name: options.config.id,
      start: () => this.#start(), open: () => { this.#open = true; },
      close: () => { this.#open = false; }, stop: () => this.#stop(),
      send: request => this.#send(request),
      management: this.#management, control: this.#control, content: this.#content,
    });
    forwardOnebot12ClientEvents(this, (name, payload) => {
      void this[endpointSpec].events.run(() => {
        if (!this.#started) return;
        void this[endpointSpec].events.platform(name, payload).catch(error => this.#warnPlatformEvent(error));
        if (name === 'event') this.#admitRaw(payload as OneBot12Event);
      }).catch(error => this.#warnPlatformEvent(error));
    });
  }

  async #start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    if (!this.#options.config.access_token) {
      // webhook 模式未配 access_token 时任何 POST 都会被放行（verifyOneBotAccessToken 直接 return true）
      logger.warn(formatCompact({
        endpoint: this.#options.config.id,
        mode: 'webhook',
        ok: false,
        error: 'missing access_token',
      }));
    }
    this.#setupRoutes();
    logger.info(formatCompact({
      op: 'listen',
      endpoint: this.#options.config.id,
      mode: 'webhook',
      path: this.#options.config.path,
    }));
  }

  async #stop(): Promise<void> {
    this.#open = false;
    for (const release of this.#routeReleases.splice(0)) release();
    this.#started = false;
    logger.debug(formatCompact({ op: 'disconnect', endpoint: this.#options.config.id }));
  }

  async #send({ conversation, payload }: EndpointSendRequest): Promise<string> {
    const materialized = await uploadOneBot12MediaSegments(
      payload,
      (action, params) => callOnebot12Client(this, action, params),
      (error) => {
        logger.warn(formatCompact({
          op: 'onebot12_upload_failed',
          endpoint: this.#options.config.id,
          error: error instanceof Error ? error.message : String(error),
        }));
      },
    );
    const message = formatOutboundSegments(materialized);
    const params = buildSendMessageParams(conversation, message);
    const data = await callOnebot12Client<{ message_id?: string }>(this, 'send_message', params);
    const messageId = data?.message_id ?? '';
    logger.debug(formatCompact({
      op: 'onebot12_send',
      endpoint: this.#options.config.id,
      kind: conversation.kind,
      conversationId: conversation.id,
      messageId,
    }));
    return messageId;
  }

  async #recallMessage(messageId: string): Promise<void> {
    if (!messageId) return;
    await callOnebot12Client(this, 'delete_message', { message_id: messageId });
  }

  async #callApi(
    action: string,
    params: Record<string, unknown> = {},
  ): Promise<import('@imhelper/onebot-v12').OneBotV12Response> {
    return this.#callAction(
      { url: this.#options.config.api_url, access_token: this.#options.config.access_token,
        self: { platform: this.#options.config.platform, user_id: this.#options.config.userId },
        ...(this.#options.signal ? { signal: this.#options.signal } : {}) },
      action,
      params,
    );
  }

  #admitRaw(ev: OneBot12Event): void {
    if (!matchesOneBot12Self(this.#options.config, ev)) return;
    this[endpointSpec].reportSelfUserId(ev.self.user_id);
    if (!isMessageEvent(ev)) {
      receiveOneBot12SideEvent(
        (name, payload) => this[endpointSpec].events.emit(name, payload),
        this.#options.config.id,
        { callApi: (action, params) => callOnebot12Client(this, action, params) },
        ev,
        logger,
      );
      return;
    }
    const conversation = { ...onebot12InboundConversation(String(this.#options.id), ev), endpoint: this[endpointSpec].identity };
    const content = formatInboundContent(ev);
    const nickname = senderNickname(ev);
    const mentioned = isBotMentioned(ev);
    void this[endpointSpec].events.message({
      event: ev,
      ...(typeof ev.time === 'number' ? { platformSentAt: ev.time * 1000 } : {}),
      conversation,
      message: { conversation, id: ev.message_id },
      content,
      sender: { id: senderUserId(ev), ...(nickname ? { name: nickname } : {}) },
      endpointId: this.#options.config.id,
      ...(mentioned ? { mentioned: true } : {}),
      metadata: Object.freeze({
        detail_type: ev.detail_type,
        user_id: ev.user_id,
        group_id: ev.group_id,
        channel_id: ev.channel_id,
        guild_id: ev.guild_id,
        time: ev.time,
        ...(nickname ? { nickname } : {}),
      }),
    }).catch((err) => {
      logger.warn(formatCompact({
        op: 'onebot12_gateway_receive_failed',
        kind: conversation.kind,
        conversationId: conversation.id,
        error: err instanceof Error ? err.message : String(err),
      }));
    });
  }

  #warnPlatformEvent(error: unknown): void {
    logger.warn(formatCompact({
      op: 'onebot12_platform_event_failed',
      error: error instanceof Error ? error.message : String(error),
    }));
  }

  #setupRoutes(): void {
    const path = this.#options.config.path;
    this.#routeReleases.push(
      this.#options.http.route('POST', path, async (request, response) => {
        await this.#handleWebhook(request, response);
      }, { summary: 'OneBot12 webhook callback', tags: ['onebot12'] }),
    );
  }

  async #handleWebhook(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      if (!verifyOneBotAccessToken(this.#options.config.access_token, request)) {
        response.writeHead(403, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ message: 'Unauthorized' }));
        return;
      }
      if (!this.#open) {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ status: 'ok' }));
        return;
      }
      await acceptHttpIngress<OneBot12Event>(request, response, event => {
        if (!matchesOneBot12Self(this.#options.config, event)) return;
        void this[endpointSpec].events.run(() => this.ingest(event as Parameters<Onebot12Client['ingest']>[0]))
          .catch(error => this.#warnPlatformEvent(error));
      });
    } catch (error) {
      logger.error('OneBot12 webhook error:', error);
      if (!response.headersSent) {
        response.writeHead(500, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ message: 'Internal Server Error' }));
      }
    }
  }
}
