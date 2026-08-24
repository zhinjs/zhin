import { Endpoint } from 'zhin.js/adapter';
/**
 * OneBot12 HTTP webhook endpoint — POST inbound + api_url outbound.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
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
import { Onebot12Client } from './client.js';
import { verifyOneBotAccessToken } from './wss-auth.js';

const logger = getLogger('onebot12');

export interface OneBot12WebhookEndpointOptions {
  readonly id: CapabilityId;
  readonly http: HttpHost;
  readonly config: OneBot12WebhookConfig;
  readonly callAction?: typeof callOneBot12Action;
}

export class OneBot12WebhookEndpoint extends Endpoint<Onebot12Client> {
  readonly client = new Onebot12Client((action, params) => this.#callApi(action, params));
  readonly #options: OneBot12WebhookEndpointOptions;
  readonly management: EndpointManagement = createOneBot12EndpointManagement(this.client);
  readonly control: EndpointControl = createRecallEndpointControl((id) => this.recallMessage(id));
  readonly content = createOneBot12ContentPort((action, params) => this.client.callApi(action, params));
  readonly #callAction: typeof callOneBot12Action;
  #routeReleases: HttpRouteRegistration[] = [];
  #open = false;
  #started = false;

  constructor(options: OneBot12WebhookEndpointOptions) {
    super();
    this.#options = options;
    this.#callAction = options.callAction ?? callOneBot12Action;
  }

  async start(): Promise<void> {
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

  open(): void {
    this.#open = true;
  }

  close(): void {
    this.#open = false;
  }

  async stop(): Promise<void> {
    this.#open = false;
    for (const release of this.#routeReleases.splice(0)) release();
    this.#started = false;
    logger.debug(formatCompact({ op: 'disconnect', endpoint: this.#options.config.id }));
  }

  async send({ conversation, payload }: EndpointSendRequest): Promise<string> {
    const materialized = await uploadOneBot12MediaSegments(
      payload,
      (action, params) => this.client.callApi(action, params),
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
    const data = await this.client.callApi('send_message', params) as { message_id?: string } | undefined;
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

  async recallMessage(messageId: string): Promise<void> {
    if (!messageId) return;
    await this.client.callApi('delete_message', { message_id: messageId });
  }

  async #callApi(action: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const apiUrl = this.#options.config.api_url;
    if (!apiUrl) {
      throw new Error('OneBot12 connection:webhook requires api_url for outbound api');
    }
    const resp = await this.#callAction(
      { url: apiUrl, access_token: this.#options.config.access_token },
      action,
      params,
    );
    return resp.data;
  }

  admit(ev: OneBot12Event): void {
    if (!this.#open) return;
    void this.emitPlatform(oneBot12PlatformEventName(ev), ev).catch((error) => {
      logger.warn(formatCompact({
        op: 'onebot12_platform_event_failed',
        error: error instanceof Error ? error.message : String(error),
      }));
    });
    if (!isMessageEvent(ev)) {
      receiveOneBot12SideEvent(
        (name, payload) => this.emit(name, payload),
        this.#options.config.id,
        this.client,
        ev,
        logger,
      );
      return;
    }
    const conversation = onebot12InboundConversation(String(this.#options.id), ev);
    const content = formatInboundContent(ev);
    const nickname = senderNickname(ev);
    const mentioned = isBotMentioned(ev);
    void this.emit('message.receive', {
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
      const raw = await readRequestBody(request);
      let ev: OneBot12Event;
      try {
        ev = JSON.parse(raw) as OneBot12Event;
      } catch {
        response.writeHead(400, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ message: 'Invalid JSON' }));
        return;
      }
      if (this.#open) this.admit(ev);
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ status: 'ok' }));
    } catch (error) {
      logger.error('OneBot12 webhook error:', error);
      if (!response.headersSent) {
        response.writeHead(500, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ message: 'Internal Server Error' }));
      }
    }
  }
}

function oneBot12PlatformEventName(ev: OneBot12Event): string {
  return [ev.type, ev.detail_type, ev.sub_type].filter(Boolean).join('.');
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_048_576) {
      request.destroy();
      throw new Error('Request body exceeds 1MB');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}
