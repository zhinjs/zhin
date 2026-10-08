import { EndpointDeliveryError } from '@zhin.js/im-contract';
/**
 * OneBot11 reverse WSS endpoint — accepts inbound WebSocket from OneBot implementation.
 */
import {
  ClientEndpoint,
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
import { createOneBot11EndpointManagement } from './endpoint-management.js';
import {
  buildSendAction,
  formatInboundContent,
  formatInboundMetadata,
  formatOutboundSegments,
  isMessageEvent,
  onebot11InboundConversation,
  senderDisplayName,
  senderUserId,
  type OneBot11Event,
  type OneBot11WssConfig,
} from './protocol.js';
import { receiveOneBot11SideEvent } from './side-event-dispatch.js';
import { createOneBot11ContentPort } from './content-port.js';
import { verifyOneBotAccessToken } from './wss-auth.js';
import {
  callOneBot11WsAction,
  handleOneBot11WsMessage,
  rejectAllPending,
} from './ws-transport.js';
import { OneBot11WsEndpoint } from './ws-endpoint.js';
import {
  type OneBot11PendingAction,
  type OneBot11WsSocket,
} from './ws-types.js';
import { callOnebot11Client, createOnebot11EndpointClient, forwardOnebot11ClientEvents, type Onebot11Client } from './client.js';

export interface OneBot11WssEndpointOptions {
  readonly id: CapabilityId;
  readonly http: HttpHost;
  readonly config: OneBot11WssConfig;
}

export class OneBot11WssEndpoint extends ClientEndpoint<Onebot11Client> {
  readonly client: Onebot11Client;
  readonly #logger!: ReturnType<typeof getAdapterLogger>;

  readonly #options: OneBot11WssEndpointOptions;
  readonly management: EndpointManagement;
  readonly control: EndpointControl = createRecallEndpointControl((id) => this.recallMessage(id));
  readonly content;
  #ws?: OneBot11WsSocket;
  #wsRelease?: () => void;
  readonly #connectionLifecycle: EndpointLifecycle;
  #connectionTask = Promise.resolve();
  #requestId = { value: 0 };
  #pending = new Map<string, OneBot11PendingAction>();
  #started = false;
  #stopped = false;

  constructor(options: OneBot11WssEndpointOptions) {
    super();
    this.#logger = getAdapterLogger('onebot11', options.config.id);
    this.#options = options;
    this.#connectionLifecycle = createEndpointLifecycle({
      name: `${options.config.id}:inbound`,
      reconnect: false,
      heartbeat: { intervalMs: options.config.heartbeat_interval, watchdogMisses: 2 },
    });
    this.client = createOnebot11EndpointClient(options.config, (action, params) => this.#callApi(action, params));
    const callApi = (action: string, params?: Record<string, unknown>) => callOnebot11Client(this.client, action, params);
    this.management = createOneBot11EndpointManagement({ callApi });
    this.content = createOneBot11ContentPort(callApi);
    this.bindClientEvents(
      (receive) => forwardOnebot11ClientEvents(this.client, receive),
      (name, payload) => {
        if (name === 'event') this.#admitRaw(payload as OneBot11Event);
      },
      (_name, error) => this.#warnPlatformEvent(error),
    );
  }

  get transportState(): EndpointTransportState {
    if (this.#stopped) return 'stopped';
    if (!this.#started) return 'idle';
    if (this.#connectionLifecycle.state === 'closed') return 'closed';
    if (this.#ws?.readyState === 1) return 'open';
    return this.#connectionLifecycle.state === 'connecting' ? 'connecting' : 'idle';
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#stopped = false;
    if (!this.#options.config.access_token) {
      // wss 模式未配 access_token 时任何连接都会被放行（verifyOneBotAccessToken 直接 return true）
      this.#logger.warn(formatCompact({
        endpoint: this.#options.config.id,
        mode: 'wss',
        ok: false,
        error: 'missing access_token',
      }));
    }
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
    this.#started = true;
    this.#logger.info(formatCompact({
      op: 'listen',
      endpoint: this.#options.config.id,
      mode: 'wss',
      path: this.#options.config.path,
    }));
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    this.close();
    this.#wsRelease?.();
    this.#wsRelease = undefined;
    await this.#connectionTask;
    await this.#connectionLifecycle.stop();
    rejectAllPending(this.#pending);
    this.#ws = undefined;
    this.#started = false;
  }

  async send({ conversation, payload }: EndpointSendRequest): Promise<string> {
    const message = formatOutboundSegments(payload);
    const { action, params } = buildSendAction(conversation, message);
    const data = await callOnebot11Client<{ message_id?: number | string }>(this.client, action, params);
    const rawId = data?.message_id;
    if ((typeof rawId !== 'number' && typeof rawId !== 'string') || String(rawId).trim() === '' || (typeof rawId === 'number' && !Number.isFinite(rawId))) {
      throw new EndpointDeliveryError('delivery_unconfirmed', 'Message delivery is unconfirmed: platform returned no message_id', 'unknown');
    }
    return String(rawId);
  }

  async recallMessage(messageId: string): Promise<void> {
    if (!messageId) return;
    await callOnebot11Client(this.client, 'delete_msg', { message_id: Number(messageId) });
  }

  #callApi(
    action: string,
    params: Record<string, unknown> = {},
  ): ReturnType<typeof callOneBot11WsAction> {
    return callOneBot11WsAction(this.#connectionLifecycle.state === 'closed' ? undefined : this.#ws, this.#pending, this.#requestId, action, params);
  }

  #admitRaw(ev: OneBot11Event): void {
    if (!isMessageEvent(ev)) {
      receiveOneBot11SideEvent(
        (name, payload) => this.emit(name, payload),
        this.#options.config.id,
        { callApi: (action, params) => callOnebot11Client(this.client, action, params) },
        ev,
        this.#logger,
      );
      return;
    }
    const conversation = onebot11InboundConversation(String(this.#options.id), ev);
    const inbound = formatInboundMetadata(ev, this.#options.config.id);
    void this.emit('message.receive', {
      conversation,
      message: { conversation, id: String(ev.message_id) },
      content: formatInboundContent(ev),
      sender: {
        id: senderUserId(ev),
        name: senderDisplayName(ev) || undefined,
        ...(ev.sender?.role ? { roles: [ev.sender.role] } : {}),
      },
      endpointId: inbound.endpointId,
      ...(inbound.mentioned ? { mentioned: true } : {}),
      ...(inbound.replyTo ? { replyTo: inbound.replyTo } : {}),
      metadata: inbound.metadata,
    }).catch((err) => {
      this.#logger.warn(formatCompact({
        op: 'onebot11_gateway_receive_failed',
        target: `${conversation.kind}:${conversation.id}`,
        error: err instanceof Error ? err.message : String(err),
      }));
    });
  }

  #warnPlatformEvent(error: unknown): void {
    this.#logger.warn(formatCompact({
      op: 'onebot11_platform_event_failed',
      error: error instanceof Error ? error.message : String(error),
    }));
  }

  async #acceptConnection(connection: WsConnection): Promise<void> {
    if (!this.#started || this.#stopped) {
      connection.socket.close();
      return;
    }
    if (!verifyOneBotAccessToken(this.#options.config.access_token, connection.request)) {
      connection.socket.close(4003, 'Unauthorized');
      return;
    }
    const socket = connection.socket as unknown as OneBot11WsSocket;
    await this.#connectionLifecycle.stop();
    rejectAllPending(this.#pending, '连接已替换');
    await this.#connectionLifecycle.start(async (lifecycleHandle) => {
      this.#ws = socket;
      lifecycleHandle.onForceClose(() => {
        if (this.#ws === socket) {
          rejectAllPending(this.#pending);
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
          socket.ping?.();
        } catch {
          /* ignore */
        }
      }, this.#options.config.heartbeat_interval);
      socket.on('pong', () => {
        if (this.#ws === socket) this.#connectionLifecycle.notifyHeartbeatAck();
      });
      socket.on('message', (data) => {
        if (this.#ws !== socket || this.#connectionLifecycle.state === 'closed') return;
        this.#connectionLifecycle.notifyHeartbeatAck();
        handleOneBot11WsMessage(data, {
          endpointId: this.#options.config.id,
          pending: this.#pending,
          ingest: (ev) => this.client.ingest(ev as Parameters<Onebot11Client['ingest']>[0]),
        });
      });
      socket.on('error', (error) => {
        if (this.#ws !== socket) return;
        this.#logger.warn(formatCompact({ op: 'ws_error', error: String(error) }));
      });
      socket.on('close', () => {
        if (this.#ws !== socket) return;
        if (this.#ws === socket) {
          this.#ws = undefined;
          rejectAllPending(this.#pending);
        }
        lifecycleHandle.notifyClosed(new Error('OneBot11 reverse WebSocket closed'));
      });
    });
    this.#logger.debug(formatCompact({
      endpoint: this.#options.config.id,
      mode: 'wss',
      peer: connection.request.socket.remoteAddress,
    }));
  }
}
