/**
 * OneBot12 reverse WSS endpoint — accepts inbound WebSocket from OneBot implementation.
 */
import {
  createEndpointSpecification, endpointSpec,
  type Endpoint, type EndpointSpecification,
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
import { createOneBot12EndpointManagement } from './endpoint-management.js';
import {
  buildSendMessageParams,
  matchesOneBot12Self,
  formatInboundContent,
  formatOutboundSegments,
  isBotMentioned,
  isMessageEvent,
  onebot12InboundConversation,
  senderNickname,
  senderUserId,
  uploadOneBot12MediaSegments,
  type OneBot12Event,
  type OneBot12WssConfig,
} from './protocol.js';
import { receiveOneBot12SideEvent } from './side-event-dispatch.js';
import { createOneBot12ContentPort } from './content-port.js';
import { callOnebot12Client, onebot12ClientOptions, forwardOnebot12ClientEvents, Onebot12Client } from './client.js';
import { verifyOneBotAccessToken } from './wss-auth.js';
import { type OneBot12PendingAction, type OneBot12WsSocket } from './ws-types.js';
import {
  callOneBot12WsAction,
  handleOneBot12WsMessage,
  rejectAllPending,
} from './ws-transport.js';

export interface OneBot12WssEndpointOptions {
  readonly id: CapabilityId;
  readonly http: HttpHost;
  readonly config: OneBot12WssConfig;
}

export class OneBot12WssEndpoint extends Onebot12Client implements Endpoint {
  readonly [endpointSpec]: EndpointSpecification;
  #open = false;
  readonly #logger!: ReturnType<typeof getAdapterLogger>;

  readonly #options: OneBot12WssEndpointOptions;
  readonly #management: EndpointManagement;
  readonly #control: EndpointControl = createRecallEndpointControl((id) => this.#recallMessage(id));
  readonly #content;
  #ws?: OneBot12WsSocket;
  #wsRelease?: () => void;
  readonly #connectionLifecycle: EndpointLifecycle;
  #connectionTask = Promise.resolve();
  #requestId = { value: 0 };
  #pending = new Map<string, OneBot12PendingAction>();
  #started = false;

  constructor(options: OneBot12WssEndpointOptions) {
    super(onebot12ClientOptions(options.config, (action, params) => this.#callAction(action, params ?? {})));
    this.#logger = getAdapterLogger('onebot12', options.config.id);
    this.#options = options;
    this.#connectionLifecycle = createEndpointLifecycle({
      name: `${options.config.id}:inbound`,
      reconnect: false,
    });
    const callApi = (action: string, params?: Record<string, unknown>) => callOnebot12Client(this, action, params);
    this.#management = createOneBot12EndpointManagement({ callApi });
    this.#content = createOneBot12ContentPort(callApi);
    const readTransportState = () => this.#connectionLifecycle.state;
    this[endpointSpec] = createEndpointSpecification(this, {
      name: options.config.id,
      start: () => this.#start(), open: () => { this.#open = true; },
      close: () => { this.#open = false; }, stop: () => this.#stop(),
      send: request => this.#send(request),
      get transportState() { return readTransportState(); },
      management: this.#management, control: this.#control, content: this.#content,
    });
    forwardOnebot12ClientEvents(this, (name, payload) => {
      void this[endpointSpec].events.run(() => {
        if (!this.#open && !this.#started) return;
        void this[endpointSpec].events.platform(name, payload).catch(error => this.#warnPlatformEvent(error));
        if (name === 'event') this.#admitRaw(payload as OneBot12Event);
      }).catch(error => this.#warnPlatformEvent(error));
    });
  }

  async #start(): Promise<void> {
    if (this.#started) return;
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

  async #stop(): Promise<void> {
    this.#open = false;
    this.#wsRelease?.();
    this.#wsRelease = undefined;
    await this.#connectionTask;
    await this.#connectionLifecycle.stop();
    rejectAllPending(this.#pending);
    this.#ws = undefined;
    this.#started = false;
  }

  async #send({ conversation, payload }: EndpointSendRequest): Promise<string> {
    const materialized = await uploadOneBot12MediaSegments(
      payload,
      (action, params) => callOnebot12Client(this, action, params),
      (error) => {
        this.#logger.warn(formatCompact({
          op: 'onebot12_upload_failed',
          endpoint: this.#options.config.id,
          error: error instanceof Error ? error.message : String(error),
        }));
      },
    );
    const message = formatOutboundSegments(materialized);
    const params = buildSendMessageParams(conversation, message);
    const data = await callOnebot12Client<{ message_id?: string }>(this, 'send_message', params);
    return data?.message_id ?? '';
  }

  async #recallMessage(messageId: string): Promise<void> {
    if (!messageId) return;
    await callOnebot12Client(this, 'delete_message', { message_id: messageId });
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
        this.#logger,
      );
      return;
    }
    const conversation = { ...onebot12InboundConversation(String(this.#options.id), ev), endpoint: this[endpointSpec].identity };
    const nickname = senderNickname(ev);
    const mentioned = isBotMentioned(ev);
    void this[endpointSpec].events.message({
      event: ev,
      ...(typeof ev.time === 'number' ? { platformSentAt: ev.time * 1000 } : {}),
      conversation,
      message: { conversation, id: ev.message_id },
      content: formatInboundContent(ev),
      sender: { id: senderUserId(ev), name: senderNickname(ev) },
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
      this.#logger.warn(formatCompact({
        op: 'onebot12_gateway_receive_failed',
        kind: conversation.kind,
        conversationId: conversation.id,
        error: err instanceof Error ? err.message : String(err),
      }));
    });
  }

  #warnPlatformEvent(error: unknown): void {
    this.#logger.warn(formatCompact({
      op: 'onebot12_platform_event_failed',
      error: error instanceof Error ? error.message : String(error),
    }));
  }

  async #acceptConnection(connection: WsConnection): Promise<void> {
    if (!verifyOneBotAccessToken(this.#options.config.access_token, connection.request)) {
      connection.socket.close(4003, 'Unauthorized');
      return;
    }
    const socket = connection.socket as unknown as OneBot12WsSocket;
    await this.#connectionLifecycle.stop();
    rejectAllPending(this.#pending, '连接已替换');
    await this.#connectionLifecycle.start(async (lifecycleHandle) => {
      this.#ws = socket;
      lifecycleHandle.onForceClose(() => {
        try {
          socket.close();
        } catch {
          /* ignore */
        }
        if (this.#ws === socket) this.#ws = undefined;
      });
      this.#connectionLifecycle.startHeartbeat(() => {
        this.#callAction('get_status', {}).catch(() => {});
      }, this.#options.config.heartbeat_interval);
      socket.on('message', (data) => {
        if (this.#ws !== socket) return;
        this.#connectionLifecycle.notifyHeartbeatAck();
        handleOneBot12WsMessage(data, {
          endpointId: this.#options.config.id,
          pending: this.#pending,
          ingest: event => {
            if (matchesOneBot12Self(this.#options.config, event)) this.ingest(event as Parameters<Onebot12Client['ingest']>[0]);
          },
        });
      });
      socket.on('close', () => {
        if (this.#ws === socket) {
          this.#ws = undefined;
          rejectAllPending(this.#pending);
        }
        lifecycleHandle.notifyClosed(new Error('OneBot12 reverse WebSocket closed'));
      });
    });
    this.#logger.debug(formatCompact({
      endpoint: this.#options.config.id,
      mode: 'wss',
      peer: connection.request.socket.remoteAddress,
    }));
  }

  #callAction(action: string, params: Record<string, unknown>) {
    return callOneBot12WsAction(this.#ws, this.#pending, this.#requestId, action, params, { platform: this.#options.config.platform, user_id: this.#options.config.userId });
  }

}
