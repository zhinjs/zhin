/**
 * OneBot12 reverse WSS endpoint — accepts inbound WebSocket from OneBot implementation.
 */
import {
  ClientEndpoint,
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
  formatInboundContent,
  formatOutboundSegments,
  isBotMentioned,
  isMessageEvent,
  onebot12InboundConversation,
  senderNickname,
  senderUserId,
  uploadOneBot12MediaSegments,
  type OneBot12ActionRequest,
  type OneBot12ActionResponse,
  type OneBot12Event,
  type OneBot12WssConfig,
} from './protocol.js';
import { receiveOneBot12SideEvent } from './side-event-dispatch.js';
import { createOneBot12ContentPort } from './content-port.js';
import { callOnebot12Client, createOnebot12EndpointClient, forwardOnebot12ClientEvents, type Onebot12Client } from './client.js';
import { verifyOneBotAccessToken } from './wss-auth.js';
import { type OneBot12WsSocket, WS_OPEN } from './ws-types.js';

export interface OneBot12WssEndpointOptions {
  readonly id: CapabilityId;
  readonly http: HttpHost;
  readonly config: OneBot12WssConfig;
}

export class OneBot12WssEndpoint extends ClientEndpoint<Onebot12Client> {
  readonly client: Onebot12Client;
  readonly #logger!: ReturnType<typeof getAdapterLogger>;

  readonly #options: OneBot12WssEndpointOptions;
  readonly management: EndpointManagement;
  readonly control: EndpointControl = createRecallEndpointControl((id) => this.recallMessage(id));
  readonly content;
  #ws?: OneBot12WsSocket;
  #wsRelease?: () => void;
  readonly #lifecycle: EndpointLifecycle;
  #requestId = 0;
  #pending = new Map<string, {
    resolve: (value: OneBot12ActionResponse) => void;
    reject: (err: Error) => void;
    timeout: NodeJS.Timeout;
  }>();

  constructor(options: OneBot12WssEndpointOptions) {
    super();
    this.#logger = getAdapterLogger('onebot12', options.config.id);
    this.#options = options;
    this.#lifecycle = createEndpointLifecycle({
      name: options.config.id,
      reconnect: false,
      heartbeat: { intervalMs: options.config.heartbeat_interval },
    });
    this.client = createOnebot12EndpointClient(options.config, (action, params) => this.#callAction(action, params ?? {}));
    const callApi = (action: string, params?: Record<string, unknown>) => callOnebot12Client(this.client, action, params);
    this.management = createOneBot12EndpointManagement({ callApi });
    this.content = createOneBot12ContentPort(callApi);
    this.bindClientEvents(
      (receive) => forwardOnebot12ClientEvents(this.client, receive),
      (name, payload) => {
        if (name === 'event') this.#admitRaw(payload as OneBot12Event);
      },
      (_name, error) => this.#warnPlatformEvent(error),
    );
  }

  async start(): Promise<void> {
    if (!this.#options.config.access_token) {
      // wss 模式未配 access_token 时任何连接都会被放行（verifyOneBotAccessToken 直接 return true）
      this.#logger.warn(formatCompact({
        endpoint: this.#options.config.id,
        mode: 'wss',
        ok: false,
        error: 'missing access_token',
      }));
    }
    await this.#lifecycle.start(async (lifecycleHandle) => {
      const handle = this.#options.http.ws(this.#options.config.path);
      this.#wsRelease = handle.onConnection((connection) => {
        this.#acceptConnection(connection);
      });
      lifecycleHandle.onForceClose(() => {
        this.#wsRelease?.();
        this.#wsRelease = undefined;
        try {
          this.#ws?.close();
        } catch {
          /* ignore */
        }
        this.#ws = undefined;
      });
    });
    this.#logger.info(formatCompact({
      op: 'listen',
      endpoint: this.#options.config.id,
      mode: 'wss',
      path: this.#options.config.path,
    }));
  }

  async stop(): Promise<void> {
    this.close();
    await this.#lifecycle.stop();
    for (const [, pending] of this.#pending) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('连接已关闭'));
    }
    this.#pending.clear();
  }

  async send({ conversation, payload }: EndpointSendRequest): Promise<string> {
    const materialized = await uploadOneBot12MediaSegments(
      payload,
      (action, params) => callOnebot12Client(this.client, action, params),
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
    const data = await callOnebot12Client<{ message_id?: string }>(this.client, 'send_message', params);
    return data?.message_id ?? '';
  }

  async recallMessage(messageId: string): Promise<void> {
    if (!messageId) return;
    await callOnebot12Client(this.client, 'delete_message', { message_id: messageId });
  }

  #admitRaw(ev: OneBot12Event): void {
    if (!isMessageEvent(ev)) {
      receiveOneBot12SideEvent(
        (name, payload) => this.emit(name, payload),
        this.#options.config.id,
        { callApi: (action, params) => callOnebot12Client(this.client, action, params) },
        ev,
        this.#logger,
      );
      return;
    }
    const conversation = onebot12InboundConversation(String(this.#options.id), ev);
    const nickname = senderNickname(ev);
    const mentioned = isBotMentioned(ev);
    void this.emit('message.receive', {
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

  #acceptConnection(connection: WsConnection): void {
    if (!verifyOneBotAccessToken(this.#options.config.access_token, connection.request)) {
      connection.socket.close(4003, 'Unauthorized');
      return;
    }
    const socket = connection.socket as unknown as OneBot12WsSocket;
    if (this.#ws) {
      try {
        this.#ws.close();
      } catch {
        /* ignore */
      }
    }
    this.#ws = socket;
    this.#lifecycle.startHeartbeat(() => {
      this.#callAction('get_status', {}).catch(() => {});
    });
    socket.on('message', (data) => {
      this.#lifecycle.notifyHeartbeatAck();
      this.#onMessage(data);
    });
    socket.on('close', () => {
      if (this.#ws === socket) {
        this.#ws = undefined;
        this.#lifecycle.stopHeartbeat();
      }
    });
    this.#logger.debug(formatCompact({
      endpoint: this.#options.config.id,
      mode: 'wss',
      peer: connection.request.socket.remoteAddress,
    }));
  }

  #onMessage(data: unknown): void {
    try {
      const raw = typeof data === 'string'
        ? data
        : Buffer.isBuffer(data)
          ? data.toString()
          : data instanceof ArrayBuffer
            ? new TextDecoder().decode(data)
            : String(data ?? '');
      const msg = JSON.parse(raw) as OneBot12Event | OneBot12ActionResponse;
      if ('echo' in msg && typeof (msg as OneBot12ActionResponse).echo === 'string') {
        const resp = msg as OneBot12ActionResponse;
        const pending = this.#pending.get(resp.echo!);
        if (pending) {
          this.#pending.delete(resp.echo!);
          clearTimeout(pending.timeout);
          pending.resolve(resp);
        }
        return;
      }
      this.client.ingest(msg as Parameters<Onebot12Client['ingest']>[0]);
    } catch (error) {
      this.#logger.warn(formatCompact({
        op: 'onebot12_parse_failed',
        endpoint: this.#options.config.id,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  #callAction(action: string, params: Record<string, unknown>): Promise<OneBot12ActionResponse> {
    if (!this.#ws || this.#ws.readyState !== WS_OPEN) {
      return Promise.reject(new Error('WebSocket 未连接'));
    }
    const echo = `ob12_${++this.#requestId}`;
    const req: OneBot12ActionRequest = { action, params, echo };
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(echo);
        reject(new Error(`OneBot12 动作超时: ${action}`));
      }, 30_000);
      this.#pending.set(echo, { resolve, reject, timeout });
      this.#ws!.send(JSON.stringify(req));
    });
  }

}
