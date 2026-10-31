import { EndpointDeliveryError } from '@zhin.js/im-contract';
/**
 * NapCat reverse WSS endpoint — accepts inbound WebSocket from NapCat.
 */
import {
  createEndpointSpecification, endpointSpec, type Endpoint, type EndpointSpecification,
  createEndpointLifecycle,
  createRecallEndpointControl,
  type EndpointLifecycle,
  type EndpointControl,
  type EndpointManagement,
  type EndpointSendRequest,
  type EndpointTransportState,
} from 'zhin.js/adapter';
import type { HttpHost, WsConnection } from '@zhin.js/host-http';
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
  formatInboundContent,
  formatOutboundSegments,
  isMessageEvent,
  napcatInboundConversation,
  napcatOutboundTarget,
  senderNickname,
  senderUserId,
  type NapCatEvent,
  type NapCatWssConfig,
} from './protocol.js';
import { receiveNapCatSideEvent } from './side-event-dispatch.js';
import { createNapCatContentPort } from './onebot-get-msg.js';
import { NapcatClient } from './client.js';
import {
  type NapCatWsSocket,
} from './ws-types.js';
import { verifyNapCatAccessToken } from './wss-auth.js';

export interface NapCatWssEndpointOptions {
  readonly id: CapabilityId;
  readonly signal?: AbortSignal;
  readonly http: HttpHost;
  readonly config: NapCatWssConfig;
}

export class NapCatWssEndpoint extends NapcatClient implements Endpoint {
  readonly [endpointSpec]: EndpointSpecification;
  readonly #logger!: ReturnType<typeof getAdapterLogger>;

  readonly #options: NapCatWssEndpointOptions;
  readonly #inboundDeduper = new InboundMessageDeduper();
  readonly #management: EndpointManagement = createNapCatEndpointManagement(this);
  readonly #control: EndpointControl = createRecallEndpointControl((id, signal) => this.#recallMessage(id, signal));
  readonly #content = createNapCatContentPort(request => this.requestApi(request));
  readonly #connectionLifecycle: EndpointLifecycle;
  #wsRelease?: () => void;
  #connectionTask = Promise.resolve();
  #open = false;
  #started = false;
  #stopped = false;

  constructor(options: NapCatWssEndpointOptions) {
    super({ config: options.config, signal: options.signal });
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
    this.#connectionLifecycle = createEndpointLifecycle({
      name: `${options.config.id}:inbound`,
      reconnect: false,
      heartbeat: { intervalMs: options.config.heartbeat_interval, watchdogMisses: 2 },
    });
  }

  get #transportState(): EndpointTransportState {
    if (this.#stopped) return 'stopped';
    if (!this.#started) return 'idle';
    if (this.#connectionLifecycle.state === 'closed') return 'closed';
    if (this.transportSocket?.readyState === 1) return 'open';
    return this.#connectionLifecycle.state === 'connecting' ? 'connecting' : 'idle';
  }

  protected override get actionSocket(): NapCatWsSocket | undefined {
    return this.#connectionLifecycle.state === 'closed' ? undefined : this.transportSocket;
  }

  async #start(): Promise<void> {
    if (this.#started) return;
    this.#stopped = false;
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

  #openEndpoint(): void {
    this.#open = true;
  }

  #close(): void {
    this.#open = false;
  }

  async #stop(): Promise<void> {
    this.#stopped = true;
    this.#open = false;
    this.#wsRelease?.();
    this.#wsRelease = undefined;
    await this.#connectionTask;
    await this.#connectionLifecycle.stop();
    this.rpc.disconnect();
    this.#inboundDeduper.clear();
    this.transportSocket = undefined;
    this.#started = false;
  }

  async #send({ conversation, payload, signal }: EndpointSendRequest): Promise<string> {
    const message = formatOutboundSegments(payload);
    const { action, params } = buildSendAction(napcatOutboundTarget(conversation), message);
    const data = await this.requestApi({ action, params, signal }) as { message_id?: number | string } | undefined;
    const rawId = data?.message_id;
    if ((typeof rawId !== 'number' && typeof rawId !== 'string') || String(rawId).trim() === '' || (typeof rawId === 'number' && !Number.isFinite(rawId))) {
      throw new EndpointDeliveryError('delivery_unconfirmed', 'Message delivery is unconfirmed: platform returned no message_id', 'unknown');
    }
    return String(rawId);
  }

  async #recallMessage(messageId: string, signal?: AbortSignal): Promise<void> {
    if (!messageId) return;
    await this.requestApi({ action: 'delete_msg', params: { message_id: Number(messageId) }, signal });
  }



  #admit(ev: NapCatEvent): void {
    const nativeEvent = ev;
    if (!this.#open && !this.#started) return;
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

  async #acceptConnection(connection: WsConnection): Promise<void> {
    if (!this.#started || this.#stopped) {
      connection.socket.close();
      return;
    }
    if (!verifyNapCatAccessToken(this.#options.config.access_token, connection.request)) {
      connection.socket.close(4003, 'Unauthorized');
      return;
    }
    const socket = connection.socket as unknown as NapCatWsSocket;
    await this.#connectionLifecycle.stop();
    this.rpc.disconnect('Connection replaced');
    await this.#connectionLifecycle.start(async (lifecycleHandle) => {
      this.transportSocket = socket;
      lifecycleHandle.onForceClose(() => {
        if (this.transportSocket === socket) {
          this.rpc.disconnect();
        }
        try {
          socket.close();
        } catch {
          /* ignore */
        }
      });
      this.#connectionLifecycle.startHeartbeat(() => {
        try {
          socket.ping?.();
        } catch {
          /* ignore */
        }
      }, this.#options.config.heartbeat_interval);
      socket.on('pong', () => {
        if (this.transportSocket === socket) this.#connectionLifecycle.notifyHeartbeatAck();
      });
      socket.on('message', (data) => {
        if (this.transportSocket !== socket || this.#connectionLifecycle.state === 'closed') return;
        this.#connectionLifecycle.notifyHeartbeatAck();
        this.rpc.receive(data, event => this.ingest(event));
      });
      socket.on('error', (error) => {
        if (this.transportSocket !== socket) return;
        this.#logger.warn(formatCompact({ op: 'ws_error', error: String(error) }));
      });
      socket.on('close', () => {
        if (this.transportSocket !== socket) return;
        this.transportSocket = undefined;
        this.rpc.disconnect();
        lifecycleHandle.notifyClosed(new Error('NapCat reverse WebSocket closed'));
      });
    });
    this.#logger.debug(formatCompact({
      endpoint: this.#options.config.id,
      mode: 'wss',
      peer: connection.request.socket.remoteAddress,
    }));
  }
}

function napCatPlatformEventName(ev: NapCatEvent): string {
  return [ev.post_type, ev.message_type ?? ev.notice_type ?? ev.request_type, ev.sub_type]
    .filter(Boolean)
    .join('.');
}
