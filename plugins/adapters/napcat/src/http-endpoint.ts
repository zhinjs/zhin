import { EndpointDeliveryError } from '@zhin.js/im-contract';
/**
 * NapCat HTTP endpoint — POST inbound events + HTTP API outbound.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  createEndpointSpecification, endpointSpec, type Endpoint, type EndpointSpecification,
  createRecallEndpointControl,
  type EndpointControl,
  type EndpointManagement,
  type EndpointSendRequest,
  type EndpointTransportState,
} from 'zhin.js/adapter';
import type { HttpHost, HttpRouteRegistration } from '@zhin.js/host-http';
import { formatCompact, getAdapterLogger } from '@zhin.js/logger';
import type { CapabilityId } from 'zhin.js';
import { createNapCatEndpointManagement } from './endpoint-management.js';
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
import { createNapCatContentPort } from './onebot-get-msg.js';
import { NapcatClient } from './client.js';
import { readRequestBody } from './webhook.js';
import { verifyNapCatAccessToken } from './wss-auth.js';

export interface NapCatHttpEndpointOptions {
  readonly id: CapabilityId;
  readonly signal?: AbortSignal;
  readonly http: HttpHost;
  readonly config: NapCatHttpConfig;
  readonly callHttpAction?: typeof callNapCatHttpAction;
}

export class NapCatHttpEndpoint extends NapcatClient implements Endpoint {
  readonly [endpointSpec]: EndpointSpecification;
  readonly #logger!: ReturnType<typeof getAdapterLogger>;

  readonly #options: NapCatHttpEndpointOptions;
  readonly #inboundDeduper = new InboundMessageDeduper();
  readonly #management: EndpointManagement = createNapCatEndpointManagement(this);
  readonly #control: EndpointControl = createRecallEndpointControl((id) => this.#recallMessage(id));
  readonly #content = createNapCatContentPort((action, params) => this.callApi(action, params));
  #routeReleases: HttpRouteRegistration[] = [];
  #open = false;
  #started = false;
  #stopped = false;

  constructor(options: NapCatHttpEndpointOptions) {
    super(options.config, options.callHttpAction ?? callNapCatHttpAction, options.signal);
    this.#logger = getAdapterLogger('napcat', options.config.id);
    this.#options = options;
    const readTransportState = () => this.#transportState;
    this[endpointSpec] = createEndpointSpecification(this, {
      name: options.config.id,
      start: () => this.#start(), open: () => this.#openEndpoint(),
      close: () => this.#close(), stop: () => this.#stop(),
      send: request => this.#send(request),
      management: this.#management, control: this.#control, content: this.#content,
      get transportState() { return readTransportState(); },
    });
    this.on('event', event => {
      void this[endpointSpec].events.run(() => this.#admit(event)).catch((error: unknown) => {
        this.#logger.debug(formatCompact({ op: 'napcat_receive_failed', error: error instanceof Error ? error.message : String(error) }));
      });
    });
  }

  get #transportState(): EndpointTransportState {
    return this.#stopped ? 'stopped' : this.#started ? 'open' : 'idle';
  }

  async #start(): Promise<void> {
    if (this.#started) return;
    this.#stopped = false;
    this.#started = true;
    this.#setupRoutes();
    this.#logger.info(formatCompact({
      op: 'listen',
      endpoint: this.#options.config.id,
      mode: 'http',
      path: this.#options.config.post_path,
    }));
  }

  #openEndpoint(): void {
    this.#open = true;
  }

  #close(): void {
    this.#open = false;
  }

  async #stop(): Promise<void> {
    this.#stopped = true;
    this.#open = false;
    for (const release of this.#routeReleases.splice(0)) release();
    this.#inboundDeduper.clear();
    this.#started = false;
    this.#logger.debug(formatCompact({ op: 'disconnect' }));
  }

  async #send({ conversation, payload }: EndpointSendRequest): Promise<string> {
    const message = formatOutboundSegments(payload);
    const { action, params } = buildSendAction(napcatOutboundTarget(conversation), message);
    const data = await this.callApi(action, params) as { message_id?: number | string } | undefined;
    const rawId = data?.message_id;
    if ((typeof rawId !== 'number' && typeof rawId !== 'string') || String(rawId).trim() === '' || (typeof rawId === 'number' && !Number.isFinite(rawId))) {
      throw new EndpointDeliveryError('delivery_unconfirmed', 'Message delivery is unconfirmed: platform returned no message_id', 'unknown');
    }
    const messageId = String(rawId);
    this.#logger.debug(formatCompact({
      op: 'napcat_send',
      endpoint: this.#options.config.id,
      target: `${conversation.kind}:${conversation.id}`,
      messageId,
    }));
    return messageId;
  }

  async #recallMessage(messageId: string): Promise<void> {
    if (!messageId) return;
    await this.callApi('delete_msg', { message_id: Number(messageId) });
  }



  #admit(ev: NapCatEvent): void {
    const nativeEvent = ev;
    if (!this.#started) return;
    void this[endpointSpec].events.platform(napCatPlatformEventName(ev), ev).catch((error) => {
      this.#logger.warn(formatCompact({
        op: 'napcat_platform_event_failed',
        error: error instanceof Error ? error.message : String(error),
      }));
    });
    if (!isMessageEvent(ev)) {
      receiveNapCatSideEvent(
        (name, payload) => this[endpointSpec].events.emit(name, payload),
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
    const conversation = { ...napcatInboundConversation(String(this.#options.id), ev), endpoint: this[endpointSpec].identity };
    const nickname = senderNickname(ev);
    const mentioned = isNapCatBotMentioned(ev);
    void this[endpointSpec].events.message({
      event: nativeEvent,
      ...(typeof nativeEvent.time === 'number' ? { platformSentAt: nativeEvent.time * 1000 } : {}),
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
      if (this.#open) {
        void this[endpointSpec].events.run(() => this.ingest(ev)).catch((error: unknown) => {
          this.#logger.debug(formatCompact({ op: 'napcat_receive_failed', error: error instanceof Error ? error.message : String(error) }));
        });
      }
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

function napCatPlatformEventName(ev: NapCatEvent): string {
  return [ev.post_type, ev.message_type ?? ev.notice_type ?? ev.request_type, ev.sub_type]
    .filter(Boolean)
    .join('.');
}
