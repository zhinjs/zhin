/**
 * OneBot11 WS client endpoint — outbound connect to OneBot implementation.
 */
import WebSocket from 'ws';
import {
  ClientEndpoint,
  createRecallEndpointControl,
  createEndpointLifecycle,
  type EndpointConnectHandle,
  type EndpointControl,
  type EndpointLifecycle,
  type EndpointManagement,
  type EndpointSendRequest,
} from 'zhin.js/adapter';
import { formatCompact, getAdapterLogger } from '@zhin.js/logger';
import type { CapabilityId } from 'zhin.js';
import { createOneBot11EndpointManagement } from './endpoint-management.js';
import {
  buildSendAction,
  buildWsConnectOptions,
  formatInboundContent,
  formatInboundMetadata,
  formatOutboundSegments,
  isMessageEvent,
  onebot11InboundConversation,
  senderDisplayName,
  senderUserId,
  type OneBot11Event,
  type OneBot11WsConfig,
} from './protocol.js';
import { receiveOneBot11SideEvent } from './side-event-dispatch.js';
import { createOneBot11ContentPort } from './content-port.js';
import {
  callOneBot11WsAction,
  handleOneBot11WsMessage,
  rejectAllPending,
} from './ws-transport.js';
import {
  type OneBot11PendingAction,
  type OneBot11WsCreateOptions,
  type OneBot11WsSocket,
} from './ws-types.js';
import { callOnebot11Client, createOnebot11EndpointClient, forwardOnebot11ClientEvents, type Onebot11Client } from './client.js';

export interface OneBot11WsEndpointOptions {
  readonly id: CapabilityId;
  readonly config: OneBot11WsConfig;
  readonly createWebSocket?: (
    url: string,
    options: OneBot11WsCreateOptions,
  ) => OneBot11WsSocket;
}

export class OneBot11WsEndpoint extends ClientEndpoint<Onebot11Client> {
  readonly client: Onebot11Client;
  readonly #logger!: ReturnType<typeof getAdapterLogger>;

  readonly #options: OneBot11WsEndpointOptions;
  readonly management: EndpointManagement;
  readonly control: EndpointControl = createRecallEndpointControl((id) => this.recallMessage(id));
  readonly content;
  readonly #lifecycle: EndpointLifecycle;
  #ws?: OneBot11WsSocket;
  #requestId = { value: 0 };
  #pending = new Map<string, OneBot11PendingAction>();

  constructor(options: OneBot11WsEndpointOptions) {
    super();
    this.#logger = getAdapterLogger('onebot11', options.config.id);
    this.#options = options;
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
    const { config } = options;
    this.#lifecycle = createEndpointLifecycle({
      name: config.id,
      reconnect: {
        initialIntervalMs: config.reconnect_interval,
        // 固定间隔（multiplier 1、无抖动），对齐旧 reconnect_interval 语义
        multiplier: 1,
        maxIntervalMs: config.reconnect_interval,
        jitterMs: 0,
      },
      heartbeat: { intervalMs: config.heartbeat_interval },
    });
  }

  async start(): Promise<void> {
    if (this.#lifecycle.started) return;
    try {
      await this.#lifecycle.start((handle) => this.#connect(handle));
    } catch (err) {
      // start 失败必须清理现场（状态复位由基座保证）
      if (this.#ws) {
        try {
          this.#ws.close();
        } catch {
          /* ignore */
        }
        this.#ws = undefined;
      }
      throw err;
    }
  }

  async stop(): Promise<void> {
    this.close();
    // 基座负责：清重连/心跳定时器、强关 ws、唤醒 stop-during-connect 竞态
    await this.#lifecycle.stop();
    rejectAllPending(this.#pending);
    this.#ws = undefined;
  }

  async send({ conversation, payload }: EndpointSendRequest): Promise<string> {
    const message = formatOutboundSegments(payload);
    const { action, params } = buildSendAction(conversation, message);
    const data = await callOnebot11Client<{ message_id?: number | string }>(this.client, action, params);
    const messageId = data?.message_id != null ? String(data.message_id) : '';
    this.#logger.debug(formatCompact({
      op: 'onebot11_send',
      endpoint: this.#options.config.id,
      target: `${conversation.kind}:${conversation.id}`,
      messageId,
    }));
    return messageId;
  }

  async recallMessage(messageId: string): Promise<void> {
    if (!messageId) return;
    await callOnebot11Client(this.client, 'delete_msg', { message_id: Number(messageId) });
  }

  #callApi(
    action: string,
    params: Record<string, unknown> = {},
  ): ReturnType<typeof callOneBot11WsAction> {
    return callOneBot11WsAction(this.#ws, this.#pending, this.#requestId, action, params);
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
    const content = formatInboundContent(ev);
    const inbound = formatInboundMetadata(ev, this.#options.config.id);
    void this.emit('message.receive', {
      conversation,
      message: { conversation, id: String(ev.message_id) },
      content,
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

  async #connect(handle: EndpointConnectHandle): Promise<void> {
    const { url, headers, safeUrl } = buildWsConnectOptions(this.#options.config);
    const create = this.#options.createWebSocket
      ?? ((connectUrl: string, options: OneBot11WsCreateOptions) =>
        new WebSocket(connectUrl, { headers: options.headers }) as unknown as OneBot11WsSocket);

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const ws = create(url, { headers });
      this.#ws = ws;
      handle.onForceClose(() => {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      });

      ws.on('open', () => {
        if (settled) return;
        settled = true;
        if (!this.#options.config.access_token) {
          this.#logger.warn(formatCompact({
            endpoint: this.#options.config.id,
            ok: false,
            error: 'missing access_token',
          }));
        }
        this.#logger.debug(formatCompact({
          endpoint: this.#options.config.id,
          mode: 'ws',
          url: safeUrl,
        }));
        this.#lifecycle.startHeartbeat(() => this.#ws?.ping?.());
        resolve();
      });

      ws.on('message', (data) => {
        handleOneBot11WsMessage(data, {
          endpointId: this.#options.config.id,
          pending: this.#pending,
          ingest: (ev) => this.client.ingest(ev as Parameters<Onebot11Client['ingest']>[0]),
        });
      });

      ws.on('close', (code, reason) => {
        const reasonStr = typeof reason === 'string'
          ? reason
          : Buffer.isBuffer(reason)
            ? reason.toString()
            : String(reason ?? '');
        const codeNum = typeof code === 'number' ? code : Number(code ?? 0);
        const codeHint = codeNum === 1005
          ? ' [无状态，多为服务端/代理未发 close 帧即断开]'
          : codeNum === 1006
            ? ' [异常关闭]'
            : '';
        if (!settled) {
          settled = true;
          reject(new Error(`OneBot11 WS 关闭: ${codeNum} ${reasonStr}`));
        }
        // 断开日志与重连武装均由基座负责；仅曾 open 的连接才会武装重连，
        // 初始连接失败由 start() 的拒绝路径复位，不产生僵尸重连。
        handle.notifyClosed(`OneBot11 WS 关闭: ${codeNum} ${reasonStr || 'closed'}${codeHint}`);
      });

      ws.on('error', (err) => {
        const error = err instanceof Error ? err : new Error(String(err));
        this.#logger.warn(formatCompact({
          op: 'ws_error',
          endpoint: this.#options.config.id,
          ok: false,
          error: error.message,
        }));
        if (!settled) {
          settled = true;
          reject(error);
        }
      });
    });
  }
}
