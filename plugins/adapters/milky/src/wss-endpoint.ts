/**
 * Milky reverse WSS endpoint — httpHostToken WS upgrade inbound + baseUrl HTTP API outbound.
 */
import {
  createEndpointSpecification, endpointSpec, type Endpoint, type EndpointSpecification,
  createEndpointLifecycle,
  createRecallEndpointControl,
  type EndpointLifecycle,
  type EndpointControl,
  type EndpointManagement,
  type EndpointSendRequest,
} from 'zhin.js/adapter';
import type { HttpHost, WsConnection } from '@zhin.js/host-http';
import { formatCompact, getAdapterLogger } from '@zhin.js/logger';
import type { CapabilityId } from 'zhin.js';
import { verifyMilkyAccessToken } from './milky-auth.js';
import { createMilkyEndpointManagement } from './endpoint-management.js';
import { createMilkyActionCaller, readMilkyResponse, type MilkyActionCaller, milkyClientOptions, forwardMilkyClientEvents, MilkyClient } from './client.js';
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
  type MilkyWssConfig,
} from './protocol.js';
import type { MilkyWsSocket } from './ws-types.js';

const WS_OPEN = 1;

export interface MilkyWssEndpointOptions {
  readonly id: CapabilityId;
  readonly signal?: AbortSignal;
  readonly http: HttpHost;
  readonly config: MilkyWssConfig;
  readonly callApi?: typeof callApi;
}

export class MilkyWssEndpoint extends MilkyClient implements Endpoint {
  readonly [endpointSpec]: EndpointSpecification;
  #open = false;
  readonly #logger!: ReturnType<typeof getAdapterLogger>;

  readonly #options: MilkyWssEndpointOptions;
  readonly #management: EndpointManagement;
  readonly #call: MilkyActionCaller;
  readonly #control: EndpointControl = createRecallEndpointControl((id, signal) => this.#recallMessage({ id, signal }));
  #ws?: MilkyWsSocket;
  #wsRelease?: () => void;
  #clientSocketRelease?: () => void;
  readonly #connectionLifecycle: EndpointLifecycle;
  #connectionTask = Promise.resolve();
  #started = false;

  constructor(options: MilkyWssEndpointOptions) {
    const call = createMilkyActionCaller({ config: options.config, request: options.callApi ?? callApi, signal: options.signal });
    super(milkyClientOptions({ config: options.config, call }));
    this.#call = call;
    this.#logger = getAdapterLogger('milky', options.config.id);
    this.#options = options;
    this.#connectionLifecycle = createEndpointLifecycle({
      name: `${options.config.id}:inbound`,
      reconnect: false,
    });
    this.#management = createMilkyEndpointManagement({
      callApi: request => call(request).then(response => readMilkyResponse(response, request.action)),
    });
    const readTransportState = () => this.#connectionLifecycle.state;
    this[endpointSpec] = createEndpointSpecification(this, {
      name: options.config.id,
      start: () => this.#start(), open: () => { this.#open = true; },
      close: () => { this.#open = false; }, stop: () => this.#stop(),
      send: request => this.#send(request),
      management: this.#management, control: this.#control,
      get transportState() { return readTransportState(); },
    });
    forwardMilkyClientEvents(this, (name, payload) => {
      void this[endpointSpec].events.run(() => {
        if (!this.#open && !this.#started) return;
        void this[endpointSpec].events.platform(name, payload).catch(error => this.#warnPlatformEvent(error));
        if (name === 'event') this.#admitRaw(payload as MilkyEvent);
      }).catch(error => this.#warnPlatformEvent(error));
    });
  }

  async #start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    const handle = this.#options.http.ws(this.#options.config.path);
    this.#wsRelease = handle.onConnection((connection) => {
      this.#connectionTask = this.#connectionTask
        .then(() => this.#acceptConnection(connection))
        .catch((error) => {
          this.#logger.warn(formatCompact({
            op: 'wss_connection_failed',
            endpoint: this.#options.config.id,
            error: error instanceof Error ? error.message : String(error),
          }));
        });
    });
    this.#logger.info(formatCompact({
      op: 'listen',
      endpoint: this.#options.config.id,
      mode: 'wss',
      path: this.#options.config.path,
    }));
  }

  async #stop(): Promise<void> {
    this.#open = false;
    this.#wsRelease?.();
    this.#wsRelease = undefined;
    await this.#connectionTask;
    await this.#connectionLifecycle.stop();
    this.#ws = undefined;
    this.#started = false;
  }

  async #send({ conversation, payload, signal }: EndpointSendRequest): Promise<string> {
    const message = formatOutboundSegments(payload);
    const { action, params } = buildSendAction(conversation, message);
    const data = readMilkyResponse<{ message_seq?: number }>(await this.#call({ action, params, signal }), action);
    const messageId = formatOutboundMessageId(conversation, data?.message_seq);
    this.#logger.debug(formatCompact({
      op: 'milky_send',
      endpoint: this.#options.config.id,
      target: `${conversation.kind}:${conversation.id}`,
      messageId,
    }));
    return messageId;
  }

  async #recallMessage({ id, signal }: { readonly id: string; readonly signal?: AbortSignal }): Promise<void> {
    const parsed = parseMilkyMessageId(id);
    if (!parsed) throw new Error(`Invalid message id: ${id}`);
    if (parsed.message_scene === 'group') {
      readMilkyResponse(await this.#call({ action: 'recall_group_message', signal, params: {
        group_id: parsed.peer_id,
        message_seq: parsed.message_seq,
      } }), 'recall_group_message');
    } else {
      readMilkyResponse(await this.#call({ action: 'recall_private_message', signal, params: {
        user_id: parsed.peer_id,
        message_seq: parsed.message_seq,
      } }), 'recall_private_message');
    }
  }

  #admitRaw(event: MilkyEvent): void {
    if (event.self_id != null) this[endpointSpec].reportSelfUserId(String(event.self_id));
    const data = parseMessageReceiveData(event);
    if (!data) return;
    this.#admitMessage(data, event);
  }

  #warnPlatformEvent(error: unknown): void {
    this.#logger.warn(formatCompact({ op: 'milky_platform_event_failed', error: error instanceof Error ? error.message : String(error) }));
  }

  #admitMessage(data: MilkyIncomingMessage, event: MilkyEvent): void {
    const conversation = { ...milkyInboundConversation(String(this.#options.id), data), endpoint: this[endpointSpec].identity };
    const target = `${conversation.kind}:${conversation.id}`;
    const content = formatInboundContent(data);
    const segments = formatInboundSegments(data);
    const audioUrl = extractInboundAudioUrl(data);
    const nickname = senderNickname(data);
    const mentioned = isMentioned(data, event.self_id);
    void this[endpointSpec].events.message({
      event,
      ...(typeof event.time === 'number' ? { platformSentAt: event.time * 1000 } : {}),
      conversation,
      message: { conversation, id: formatInboundMessageId(data) },
      content,
      segments,
      sender: { id: String(data.sender_id) },
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

  async #acceptConnection(connection: WsConnection): Promise<void> {
    if (!verifyMilkyAccessToken(this.#options.config.access_token, connection.request)) {
      connection.socket.close(4003, 'Unauthorized');
      return;
    }
    const socket = connection.socket as unknown as MilkyWsSocket;
    await this.#connectionLifecycle.stop();
    await this.#connectionLifecycle.start(async (lifecycleHandle) => {
      this.#ws = socket;
      const releaseClientSocket = this.acceptWebSocket(socket);
      this.#clientSocketRelease = releaseClientSocket;
      lifecycleHandle.onForceClose(() => {
        if (this.#clientSocketRelease === releaseClientSocket) {
          releaseClientSocket();
          this.#clientSocketRelease = undefined;
        }
        try {
          socket.close();
        } catch {
          /* ignore */
        }
        if (this.#ws === socket) this.#ws = undefined;
      });
      this.#connectionLifecycle.startHeartbeat(() => {
        try {
          if (socket.readyState === WS_OPEN) socket.ping?.();
        } catch {
          /* ignore */
        }
      }, this.#options.config.heartbeat_interval);
      socket.on('message', () => {
        this.#connectionLifecycle.notifyHeartbeatAck();
      });
      socket.on('close', () => {
        if (this.#clientSocketRelease === releaseClientSocket) {
          releaseClientSocket();
          this.#clientSocketRelease = undefined;
        }
        if (this.#ws === socket) this.#ws = undefined;
        lifecycleHandle.notifyClosed(new Error('Milky reverse WebSocket closed'));
      });
    });
    this.#logger.debug(formatCompact({
      endpoint: this.#options.config.id,
      mode: 'wss',
      peer: connection.request.socket.remoteAddress,
    }));
  }

}
