/**
 * NapCat HTTP endpoint — POST inbound events + HTTP API outbound.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { EndpointInstance } from '@zhin.js/adapter';
import type { MessageGateway } from '@zhin.js/core/runtime';
import type { HttpHost, HttpRouteRegistration } from '@zhin.js/host-http';
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { CapabilityId } from '@zhin.js/plugin-runtime';
import { registerNapcatAgentEndpoint } from './napcat-agent-deps.js';
import {
  InboundMessageDeduper,
  isNapCatBotMentioned,
  isSelfMessage,
  normalizeMessage,
} from './napcat-inbound.js';
import {
  buildSendAction,
  callNapCatHttpAction,
  formatInboundContent,
  formatInboundTarget,
  formatOutboundSegments,
  isMessageEvent,
  senderNickname,
  senderUserId,
  type NapCatEvent,
  type NapCatHttpConfig,
} from './protocol.js';
import { readRequestBody } from './webhook.js';
import { NapCatWsEndpoint } from './ws-endpoint.js';
import { verifyNapCatAccessToken } from './wss-auth.js';

const logger = getLogger('napcat');

export interface NapCatHttpEndpointOptions {
  readonly id: CapabilityId;
  readonly gateway: MessageGateway;
  readonly http: HttpHost;
  readonly config: NapCatHttpConfig;
  readonly callHttpAction?: typeof callNapCatHttpAction;
}

export class NapCatHttpEndpoint implements EndpointInstance {
  readonly #options: NapCatHttpEndpointOptions;
  readonly #inboundDeduper = new InboundMessageDeduper();
  readonly #callHttpAction: typeof callNapCatHttpAction;
  #routeReleases: HttpRouteRegistration[] = [];
  #open = false;
  #started = false;
  #unregisterAgent?: () => void;

  constructor(options: NapCatHttpEndpointOptions) {
    this.#options = options;
    this.#callHttpAction = options.callHttpAction ?? callNapCatHttpAction;
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    this.#unregisterAgent = registerNapcatAgentEndpoint(
      this.#options.config.name,
      this as unknown as NapCatWsEndpoint,
    );
    this.#setupRoutes();
    logger.info(formatCompact({
      op: 'listen',
      endpoint: this.#options.config.name,
      mode: 'http',
      path: this.#options.config.post_path,
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
    this.#unregisterAgent?.();
    this.#unregisterAgent = undefined;
    this.#inboundDeduper.clear();
    this.#started = false;
    logger.debug(formatCompact({ op: 'disconnect', endpoint: this.#options.config.name }));
  }

  async send({ target, payload }: { readonly target: string; readonly payload: unknown }): Promise<string> {
    const message = formatOutboundSegments(payload);
    const { action, params } = buildSendAction(target, message);
    const resp = await this.#callHttpAction(
      {
        http_url: this.#options.config.http_url,
        access_token: this.#options.config.access_token,
      },
      action,
      params,
    );
    const data = resp.data as { message_id?: number | string } | undefined;
    const messageId = data?.message_id != null ? String(data.message_id) : '';
    logger.debug(formatCompact({
      op: 'napcat_send',
      endpoint: this.#options.config.name,
      target,
      messageId,
    }));
    return messageId;
  }

  callApi(action: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return this.#callHttpAction(
      {
        http_url: this.#options.config.http_url,
        access_token: this.#options.config.access_token,
      },
      action,
      params,
    ).then((resp) => resp.data);
  }

  admit(ev: NapCatEvent): void {
    if (!this.#open || !isMessageEvent(ev)) return;
    if (isSelfMessage(ev)) return;
    const msgId = String(ev.message_id);
    if (!this.#inboundDeduper.shouldProcess(msgId)) return;
    if (Array.isArray(ev.message) || typeof ev.message === 'string') {
      ev = { ...ev, message: normalizeMessage(ev.message) };
    }
    const target = formatInboundTarget(ev);
    const nickname = senderNickname(ev);
    const mentioned = isNapCatBotMentioned(ev);
    void this.#options.gateway.receive({
      adapter: this.#options.id,
      target,
      content: formatInboundContent(ev),
      sender: senderUserId(ev),
      id: msgId,
      metadata: Object.freeze({
        message_type: ev.message_type,
        user_id: ev.user_id != null ? String(ev.user_id) : undefined,
        group_id: ev.group_id != null ? String(ev.group_id) : undefined,
        endpoint: this.#options.config.name,
        time: ev.time,
        self_id: ev.self_id != null ? String(ev.self_id) : undefined,
        role: ev.sender?.role,
        ...(nickname ? { nickname } : {}),
        ...(mentioned ? { mentioned: true } : {}),
      }),
    }).catch((err) => {
      logger.warn(formatCompact({
        op: 'napcat_gateway_receive_failed',
        target,
        error: err instanceof Error ? err.message : String(err),
      }));
    });
  }

  #setupRoutes(): void {
    const path = this.#options.config.post_path;
    this.#routeReleases.push(
      this.#options.http.route('POST', path, async (request, response) => {
        await this.#handlePost(request, response);
      }, { summary: 'NapCat HTTP event callback', tags: ['napcat'] }),
    );
  }

  async #handlePost(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      if (!verifyNapCatAccessToken(this.#options.config.access_token, request)) {
        response.writeHead(403, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ message: 'Unauthorized' }));
        return;
      }
      const raw = await readRequestBody(request);
      let ev: NapCatEvent;
      try {
        ev = JSON.parse(raw) as NapCatEvent;
      } catch {
        response.writeHead(400, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ message: 'Invalid JSON' }));
        return;
      }
      if (this.#open) this.admit(ev);
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ status: 'ok' }));
    } catch (error) {
      logger.error('NapCat HTTP webhook error:', error);
      if (!response.headersSent) {
        response.writeHead(500, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ message: 'Internal Server Error' }));
      }
    }
  }
}
