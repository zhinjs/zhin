/**
 * NapCat HTTP endpoint — POST inbound events + HTTP API outbound.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { EndpointInstance, EndpointManagement, EndpointSendRequest } from 'zhin.js/adapter';
import type { MessageGateway, SideEventGateway } from '@zhin.js/core/runtime';
import type { HttpHost, HttpRouteRegistration } from '@zhin.js/host-http';
import { formatCompact, getAdapterLogger } from '@zhin.js/logger';
import type { CapabilityId } from 'zhin.js';
import { createNapCatEndpointManagement } from './endpoint-management.js';
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
  formatOutboundSegments,
  isMessageEvent,
  napcatInboundConversation,
  napcatOutboundTarget,
  senderNickname,
  senderUserId,
  type NapCatEvent,
  type NapCatHttpConfig,
} from './protocol.js';
import { receiveNapCatSideEvent } from './side-event-dispatch.js';
import { readRequestBody } from './webhook.js';
import { NapCatWsEndpoint } from './ws-endpoint.js';
import { verifyNapCatAccessToken } from './wss-auth.js';

export interface NapCatHttpEndpointOptions {
  readonly id: CapabilityId;
  readonly gateway: MessageGateway;
  readonly sideEvents?: SideEventGateway;
  readonly http: HttpHost;
  readonly config: NapCatHttpConfig;
  readonly callHttpAction?: typeof callNapCatHttpAction;
}

export class NapCatHttpEndpoint implements EndpointInstance {
  readonly #logger!: ReturnType<typeof getAdapterLogger>;

  readonly #options: NapCatHttpEndpointOptions;
  readonly #inboundDeduper = new InboundMessageDeduper();
  readonly management: EndpointManagement = createNapCatEndpointManagement(this);
  readonly #callHttpAction: typeof callNapCatHttpAction;
  #routeReleases: HttpRouteRegistration[] = [];
  #open = false;
  #started = false;
  #unregisterAgent?: () => void;

  constructor(options: NapCatHttpEndpointOptions) {
    this.#logger = getAdapterLogger('napcat', options.config.id);
    this.#options = options;
    this.#callHttpAction = options.callHttpAction ?? callNapCatHttpAction;
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    this.#unregisterAgent = registerNapcatAgentEndpoint(
      this.#options.config.id,
      this as unknown as NapCatWsEndpoint,
    );
    this.#setupRoutes();
    this.#logger.info(formatCompact({
      op: 'listen',
      endpoint: this.#options.config.id,
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
    this.#logger.debug(formatCompact({ op: 'disconnect' }));
  }

  async send({ conversation, payload }: EndpointSendRequest): Promise<string> {
    const message = formatOutboundSegments(payload);
    const { action, params } = buildSendAction(napcatOutboundTarget(conversation), message);
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
    this.#logger.debug(formatCompact({
      op: 'napcat_send',
      endpoint: this.#options.config.id,
      target: `${conversation.kind}:${conversation.id}`,
      messageId,
    }));
    return messageId;
  }

  async recallMessage(messageId: string): Promise<void> {
    if (!messageId) return;
    await this.callApi('delete_msg', { message_id: Number(messageId) });
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
    if (!this.#open) return;
    if (!isMessageEvent(ev)) {
      receiveNapCatSideEvent(
        this.#options.sideEvents,
        this.#options.config.id,
        this,
        ev,
        this.#logger,
      );
      return;
    }
    if (isSelfMessage(ev)) return;
    const msgId = String(ev.message_id);
    if (!this.#inboundDeduper.shouldProcess(msgId)) return;
    if (Array.isArray(ev.message) || typeof ev.message === 'string') {
      ev = { ...ev, message: normalizeMessage(ev.message) };
    }
    const conversation = napcatInboundConversation(String(this.#options.id), ev);
    const nickname = senderNickname(ev);
    const mentioned = isNapCatBotMentioned(ev);
    void this.#options.gateway.receive({
      conversation,
      message: { conversation, id: msgId },
      content: formatInboundContent(ev),
      sender: {
        id: senderUserId(ev),
        name: nickname,
        ...(ev.sender?.role ? { roles: [ev.sender.role] } : {}),
      },
      endpointId: this.#options.config.id,
      ...(mentioned ? { mentioned: true } : {}),
      metadata: Object.freeze({
        message_type: ev.message_type,
        user_id: ev.user_id != null ? String(ev.user_id) : undefined,
        group_id: ev.group_id != null ? String(ev.group_id) : undefined,
        time: ev.time,
        self_id: ev.self_id != null ? String(ev.self_id) : undefined,
        role: ev.sender?.role,
        ...(nickname ? { nickname } : {}),
      }),
    }).catch((err) => {
      this.#logger.warn(formatCompact({
        op: 'napcat_gateway_receive_failed',
        target: `${conversation.kind}:${conversation.id}`,
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
      this.#logger.error('NapCat HTTP webhook error:', error);
      if (!response.headersSent) {
        response.writeHead(500, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ message: 'Internal Server Error' }));
      }
    }
  }
}
