/**
 * OneBot12 WS client endpoint — outbound connect to OneBot implementation.
 */
import WebSocket from 'ws';
import {
  createEndpointSpecification, endpointSpec,
  type Endpoint, type EndpointSpecification,
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
import { createOneBot12EndpointManagement } from './endpoint-management.js';
import {
  buildSendMessageParams,
  matchesOneBot12Self,
  buildWsConnectOptions,
  formatInboundContent,
  formatOutboundSegments,
  isBotMentioned,
  isMessageEvent,
  onebot12InboundConversation,
  senderNickname,
  senderUserId,
  uploadOneBot12MediaSegments,
  type OneBot12Event,
  type OneBot12WsConfig,
} from './protocol.js';
import { receiveOneBot12SideEvent } from './side-event-dispatch.js';
import { createOneBot12ContentPort } from './content-port.js';
import { callOnebot12Client, onebot12ClientOptions, forwardOnebot12ClientEvents, Onebot12Client } from './client.js';
import {
  type OneBot12PendingAction,
  type OneBot12WsCreateOptions,
  type OneBot12WsSocket,
} from './ws-types.js';
import {
  callOneBot12WsAction,
  handleOneBot12WsMessage,
  rejectAllPending,
} from './ws-transport.js';

export interface OneBot12WsEndpointOptions {
  readonly id: CapabilityId;
  readonly config: OneBot12WsConfig;
  readonly createWebSocket?: (
    url: string,
    options: OneBot12WsCreateOptions,
  ) => OneBot12WsSocket;
}

export class OneBot12WsEndpoint extends Onebot12Client implements Endpoint {
  readonly [endpointSpec]: EndpointSpecification;
  #open = false;
  readonly #logger!: ReturnType<typeof getAdapterLogger>;

  readonly #options: OneBot12WsEndpointOptions;
  readonly #management: EndpointManagement;
  readonly #control: EndpointControl = createRecallEndpointControl((id) => this.#recallMessage(id));
  readonly #content;
  readonly #lifecycle: EndpointLifecycle;
  #ws?: OneBot12WsSocket;
  #requestId = { value: 0 };
  #pending = new Map<string, OneBot12PendingAction>();

  constructor(options: OneBot12WsEndpointOptions) {
    super(onebot12ClientOptions(options.config, (action, params) => this.#callAction(action, params ?? {})));
    this.#logger = getAdapterLogger('onebot12', options.config.id);
    this.#options = options;
    const callApi = (action: string, params?: Record<string, unknown>) => callOnebot12Client(this, action, params);
    this.#management = createOneBot12EndpointManagement({ callApi });
    this.#content = createOneBot12ContentPort(callApi);
    const readTransportState = () => this.#lifecycle.state;
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
        if (!this.#open && !this.#lifecycle.started) return;
        void this[endpointSpec].events.platform(name, payload).catch(error => this.#warnPlatformEvent(error));
        if (name === 'event') this.#admitRaw(payload as OneBot12Event);
      }).catch(error => this.#warnPlatformEvent(error));
    });
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

  async #start(): Promise<void> {
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

  async #stop(): Promise<void> {
    this.#open = false;
    // 基座负责：清重连/心跳定时器、强关 ws、唤醒 stop-during-connect 竞态
    await this.#lifecycle.stop();
    rejectAllPending(this.#pending);
    this.#ws = undefined;
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
    const messageId = data?.message_id ?? '';
    this.#logger.debug(formatCompact({
      op: 'onebot12_send',
      endpoint: this.#options.config.id,
      kind: conversation.kind,
      conversationId: conversation.id,
      messageId,
    }));
    return messageId;
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
    const content = formatInboundContent(ev);
    const nickname = senderNickname(ev);
    const mentioned = isBotMentioned(ev);
    void this[endpointSpec].events.message({
      event: ev,
      ...(typeof ev.time === 'number' ? { platformSentAt: ev.time * 1000 } : {}),
      conversation,
      message: { conversation, id: ev.message_id },
      content,
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

  async #connect(handle: EndpointConnectHandle): Promise<void> {
    const { url, headers, safeUrl } = buildWsConnectOptions(this.#options.config);
    const create = this.#options.createWebSocket
      ?? ((connectUrl: string, options: OneBot12WsCreateOptions) =>
        new WebSocket(connectUrl, { headers: options.headers }) as unknown as OneBot12WsSocket);

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
        this.#logger.debug(formatCompact({
          endpoint: this.#options.config.id,
          mode: 'ws',
          url: safeUrl,
        }));
        this.#lifecycle.startHeartbeat(() => {
          this.#callAction('get_status', {}).catch(() => {});
        });
        resolve();
      });

      ws.on('message', (data) => {
        if (this.#ws !== ws) return;
        this.#lifecycle.notifyHeartbeatAck();
        handleOneBot12WsMessage(data, {
          endpointId: this.#options.config.id,
          pending: this.#pending,
          ingest: event => {
            if (matchesOneBot12Self(this.#options.config, event)) this.ingest(event as Parameters<Onebot12Client['ingest']>[0]);
          },
        });
      });

      ws.on('close', (code, reason) => {
        const reasonStr = typeof reason === 'string'
          ? reason
          : Buffer.isBuffer(reason)
            ? reason.toString()
            : String(reason ?? '');
        const codeNum = typeof code === 'number' ? code : Number(code ?? 0);
        if (!settled) {
          settled = true;
          reject(new Error(`OneBot12 WS 关闭: ${codeNum} ${reasonStr}`));
        }
        if (this.#ws === ws) {
          this.#ws = undefined;
          rejectAllPending(this.#pending);
        }
        // 断开日志与重连武装均由基座负责；仅曾 open 的连接才会武装重连，
        // 初始连接失败由 start() 的拒绝路径复位，不产生僵尸重连。
        handle.notifyClosed(`OneBot12 WS 关闭: ${codeNum} ${reasonStr || 'closed'}`);
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

  #callAction(action: string, params: Record<string, unknown>) {
    return callOneBot12WsAction(this.#ws, this.#pending, this.#requestId, action, params, { platform: this.#options.config.platform, user_id: this.#options.config.userId });
  }
}
