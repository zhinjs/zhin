/**
 * OneBot12 HTTP webhook endpoint — POST inbound + api_url outbound.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { EndpointInstance } from '@zhin.js/adapter';
import type { MessageGateway } from '@zhin.js/core/runtime';
import type { HttpHost, HttpRouteRegistration } from '@zhin.js/host-http';
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { CapabilityId } from '@zhin.js/plugin-runtime';
import {
  buildSendMessageParams,
  callOneBot12Action,
  formatInboundContent,
  formatInboundTarget,
  formatOutboundSegments,
  isBotMentioned,
  isMessageEvent,
  senderNickname,
  senderUserId,
  type OneBot12Event,
  type OneBot12WebhookConfig,
} from './protocol.js';
import { verifyOneBotAccessToken } from './wss-auth.js';

const logger = getLogger('onebot12');

export interface OneBot12WebhookEndpointOptions {
  readonly id: CapabilityId;
  readonly gateway: MessageGateway;
  readonly http: HttpHost;
  readonly config: OneBot12WebhookConfig;
  readonly callAction?: typeof callOneBot12Action;
}

export class OneBot12WebhookEndpoint implements EndpointInstance {
  readonly #options: OneBot12WebhookEndpointOptions;
  readonly #callAction: typeof callOneBot12Action;
  #routeReleases: HttpRouteRegistration[] = [];
  #open = false;
  #started = false;

  constructor(options: OneBot12WebhookEndpointOptions) {
    this.#options = options;
    this.#callAction = options.callAction ?? callOneBot12Action;
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    this.#setupRoutes();
    logger.info(formatCompact({
      op: 'listen',
      endpoint: this.#options.config.name,
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
    logger.debug(formatCompact({ op: 'disconnect', endpoint: this.#options.config.name }));
  }

  async send({ target, payload }: { readonly target: string; readonly payload: unknown }): Promise<string> {
    const apiUrl = this.#options.config.api_url;
    if (!apiUrl) {
      throw new Error('OneBot12 connection:webhook requires api_url for outbound send');
    }
    const message = formatOutboundSegments(payload);
    const params = buildSendMessageParams(target, message);
    const resp = await this.#callAction(
      { url: apiUrl, access_token: this.#options.config.access_token },
      'send_message',
      params,
    );
    const data = resp.data as { message_id?: string } | undefined;
    const messageId = data?.message_id ?? '';
    logger.debug(formatCompact({
      op: 'onebot12_send',
      endpoint: this.#options.config.name,
      target,
      messageId,
    }));
    return messageId;
  }

  admit(ev: OneBot12Event): void {
    if (!this.#open || !isMessageEvent(ev)) return;
    const target = formatInboundTarget(ev);
    const content = formatInboundContent(ev);
    const nickname = senderNickname(ev);
    const mentioned = isBotMentioned(ev);
    void this.#options.gateway.receive({
      adapter: this.#options.id,
      target,
      content,
      sender: senderUserId(ev),
      id: ev.message_id,
      metadata: Object.freeze({
        detail_type: ev.detail_type,
        user_id: ev.user_id,
        group_id: ev.group_id,
        channel_id: ev.channel_id,
        guild_id: ev.guild_id,
        endpoint: this.#options.config.name,
        time: ev.time,
        ...(nickname ? { nickname } : {}),
        ...(mentioned ? { mentioned: true } : {}),
      }),
    }).catch((err) => {
      logger.warn(formatCompact({
        op: 'onebot12_gateway_receive_failed',
        target,
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
