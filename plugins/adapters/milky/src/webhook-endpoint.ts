/**
 * Milky webhook endpoint — httpHostToken POST inbound + baseUrl HTTP API outbound.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  ClientEndpoint,
  createRecallEndpointControl,
  type EndpointControl,
  type EndpointManagement,
  type EndpointSendRequest,
} from 'zhin.js/adapter';
import type { HttpHost, HttpRouteRegistration } from '@zhin.js/host-http';
import { formatCompact, getAdapterLogger } from '@zhin.js/logger';
import type { CapabilityId } from 'zhin.js';
import { verifyMilkyAccessToken } from './milky-auth.js';
import { createMilkyEndpointManagement } from './endpoint-management.js';
import { callMilkyClient, createMilkyEndpointClient, forwardMilkyClientEvents, type MilkyClient } from './client.js';
import {
  buildSendAction,
  callApi,
  extractInboundAudioUrl,
  formatInboundContent,
  formatInboundMessageId,
  formatInboundSegments,
  formatOutboundMessageId,
  formatOutboundSegments,
  isMentioned,
  milkyInboundConversation,
  parseMessageReceiveData,
  parseMilkyMessageId,
  senderNickname,
  type MilkyEvent,
  type MilkyIncomingMessage,
  type MilkyWebhookConfig,
} from './protocol.js';

export interface MilkyWebhookEndpointOptions {
  readonly id: CapabilityId;
  readonly http: HttpHost;
  readonly config: MilkyWebhookConfig;
  readonly callApi?: typeof callApi;
}

export class MilkyWebhookEndpoint extends ClientEndpoint<MilkyClient> {
  readonly client: MilkyClient;
  readonly #logger!: ReturnType<typeof getAdapterLogger>;

  readonly #options: MilkyWebhookEndpointOptions;
  readonly #callApi: typeof callApi;
  readonly management: EndpointManagement;
  readonly control: EndpointControl = createRecallEndpointControl((id) => this.recallMessage(id));
  #routeReleases: HttpRouteRegistration[] = [];
  #started = false;

  constructor(options: MilkyWebhookEndpointOptions) {
    super();
    this.#logger = getAdapterLogger('milky', options.config.id);
    this.#options = options;
    this.#callApi = options.callApi ?? callApi;
    this.client = createMilkyEndpointClient(options.config, this.#callApi);
    this.management = createMilkyEndpointManagement({
      callApi: (action, params) => callMilkyClient(this.client, action, params),
    });
    this.bindClientEvents(
      (receive) => forwardMilkyClientEvents(this.client, receive),
      (name, payload) => {
        if (name === 'event') this.#admitRaw(payload as MilkyEvent);
      },
      (_name, error) => this.#warnPlatformEvent(error),
    );
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    this.#setupRoutes();
    this.#logger.info(formatCompact({
      op: 'listen',
      endpoint: this.#options.config.id,
      mode: 'webhook',
      path: this.#options.config.path,
    }));
  }

  async stop(): Promise<void> {
    this.close();
    for (const release of this.#routeReleases.splice(0)) release();
    this.#started = false;
    this.#logger.debug(formatCompact({ op: 'disconnect' }));
  }

  async send({ conversation, payload }: EndpointSendRequest): Promise<string> {
    const message = formatOutboundSegments(payload);
    const { action, params } = buildSendAction(conversation, message);
    const data = await callMilkyClient<{ message_seq?: number }>(this.client, action, params);
    const messageId = formatOutboundMessageId(conversation, data?.message_seq);
    this.#logger.debug(formatCompact({
      op: 'milky_send',
      endpoint: this.#options.config.id,
      target: `${conversation.kind}:${conversation.id}`,
      messageId,
    }));
    return messageId;
  }

  async recallMessage(id: string): Promise<void> {
    const parsed = parseMilkyMessageId(id);
    if (!parsed) throw new Error(`Invalid message id: ${id}`);
    if (parsed.message_scene === 'group') {
      await callMilkyClient(this.client, 'recall_group_message', {
        group_id: parsed.peer_id,
        message_seq: parsed.message_seq,
      });
    } else {
      await callMilkyClient(this.client, 'recall_private_message', {
        user_id: parsed.peer_id,
        message_seq: parsed.message_seq,
      });
    }
  }

  #admitRaw(event: MilkyEvent): void {
    const data = parseMessageReceiveData(event);
    if (!data) return;
    this.#admitMessage(data, event);
  }

  #warnPlatformEvent(error: unknown): void {
    this.#logger.warn(formatCompact({ op: 'milky_platform_event_failed', error: error instanceof Error ? error.message : String(error) }));
  }

  #admitMessage(data: MilkyIncomingMessage, event: MilkyEvent): void {
    const conversation = milkyInboundConversation(String(this.#options.id), data);
    const target = `${conversation.kind}:${conversation.id}`;
    const content = formatInboundContent(data);
    const segments = formatInboundSegments(data);
    const audioUrl = extractInboundAudioUrl(data);
    const nickname = senderNickname(data);
    const mentioned = isMentioned(data, event.self_id);
    void this.emit('message.receive', {
      conversation,
      message: { conversation, id: formatInboundMessageId(data) },
      content,
      segments,
      sender: { id: String(data.sender_id), name: nickname },
      endpointId: this.#options.config.id,
      ...(mentioned ? { mentioned: true } : {}),
      metadata: Object.freeze({
        message_scene: data.message_scene,
        peer_id: String(data.peer_id),
        sender_id: String(data.sender_id),
        message_seq: data.message_seq,
        time: data.time ?? event.time,
        self_id: event.self_id != null ? String(event.self_id) : undefined,
        ...(nickname ? { nickname } : {}),
      }),
    }).catch((err) => {
      this.#logger.warn(formatCompact({
        op: 'milky_gateway_receive_failed',
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
      }, { summary: 'Milky webhook callback', tags: ['milky'] }),
    );
  }

  async #handleWebhook(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      if (!verifyMilkyAccessToken(this.#options.config.access_token, request)) {
        response.writeHead(403, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ message: 'Unauthorized' }));
        return;
      }
      if (!this.clientEventsOpen) {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ status: 'ok' }));
        return;
      }
      await this.client.acceptHttp(request, response);
    } catch (error) {
      this.#logger.error('Milky webhook error:', error);
      if (!response.headersSent) {
        response.writeHead(500, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ message: 'Internal Server Error' }));
      }
    }
  }
}
