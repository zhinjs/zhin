import { EndpointDeliveryError } from '@zhin.js/im-contract';
/**
 * OneBot11 WS client endpoint — outbound connect to OneBot implementation.
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
  type PendingRpcRequest,
  type EndpointTransportState,
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
import { createOneBot11Rpc, type OneBot11Rpc } from './ws-transport.js';
import {
  type OneBot11WsCreateOptions,
  type OneBot11WsSocket,
} from './ws-types.js';
import { probeOnebot11SelfId, resolveOnebot11SelfId } from './self-id.js';
import { callOnebot11Client, readOnebot11Response, onebot11ClientOptions, forwardOnebot11ClientEvents, Onebot11Client } from './client.js';

export interface OneBot11WsEndpointOptions {
  readonly signal?: AbortSignal;
  readonly id: CapabilityId;
  /** 连接后 best-effort 调用 get_login_info 上报账号（Adapter 工厂开启；默认关闭以免占用首个 echo）。 */
  readonly probeLoginInfo?: boolean;
  readonly config: OneBot11WsConfig;
  readonly createWebSocket?: (
    url: string,
    options: OneBot11WsCreateOptions,
  ) => OneBot11WsSocket;
}

export class OneBot11WsEndpoint extends Onebot11Client implements Endpoint {
  readonly [endpointSpec]: EndpointSpecification;
  #open = false;
  readonly #logger!: ReturnType<typeof getAdapterLogger>;

  readonly #options: OneBot11WsEndpointOptions;
  readonly #management: EndpointManagement;
  readonly #control: EndpointControl = createRecallEndpointControl((id, signal?: AbortSignal) => this.#recallMessage(id, signal));
  readonly #content;
  readonly #releaseClientEvents: () => void;
  readonly #lifecycle: EndpointLifecycle;
  #ws?: OneBot11WsSocket;
  #stopped = false;
  readonly #rpc: OneBot11Rpc;

  constructor(options: OneBot11WsEndpointOptions) {
    const rpc = createOneBot11Rpc({ endpointId: options.config.id, signal: options.signal,
      socket: () => this.#lifecycle.state === 'open' ? this.#ws : undefined,
    });
    super(onebot11ClientOptions(options.config, (action, params) => rpc.call({ action, params })));
    this.#rpc = rpc;
    this.#logger = getAdapterLogger('onebot11', options.config.id);
    this.#options = options;
    const callApi = (request: PendingRpcRequest) => this.#rpc.call(request).then(readOnebot11Response);
    this.#management = createOneBot11EndpointManagement({ callApi });
    this.#content = createOneBot11ContentPort(callApi);
    const readTransportState = () => this.#lifecycle.state;
    this[endpointSpec] = createEndpointSpecification(this, {
      name: options.config.id,
      start: () => this.#start(), open: () => { this.#open = true; },
      close: () => { this.#open = false; }, stop: () => this.#stop(),
      send: request => this.#send(request),
      get transportState() { return readTransportState(); },
      management: this.#management, control: this.#control, content: this.#content,
    });
    this.#releaseClientEvents = forwardOnebot11ClientEvents(this, (name, payload) => {
      void this[endpointSpec].events.run(() => {
        // A native frame can arrive before start resolves. The spec owns candidate
        // buffering and Root/child admission; transport start is not publication.
        if (this.#stopped || (!this.#open && !this.#lifecycle.started)) return;
        void this[endpointSpec].events.platform(name, payload).catch(error => this.#warnPlatformEvent(error));
        if (name === 'event') this.#admitRaw(payload as OneBot11Event);
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
      heartbeat: { intervalMs: config.heartbeat_interval, watchdogMisses: 2 },
    });
  }

  get #transportState(): EndpointTransportState {
    return this.#lifecycle.state;
  }

  async #start(): Promise<void> {
    if (this.#lifecycle.started) return;
    this.#stopped = false;
    try {
      await this.#lifecycle.start((handle) => this.#connect(handle));
      if (this.#options.probeLoginInfo) void this.#probeSelfUserId();
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
    this.#stopped = true;
    this.#open = false;
    // 基座负责：清重连/心跳定时器、强关 ws、唤醒 stop-during-connect 竞态
    try { await this.#lifecycle.stop(); }
    finally {
      this.#rpc.dispose();
      this.#releaseClientEvents();
      this.#ws = undefined;
      this[endpointSpec].reportSelfUserId(undefined);
    }
  }

  async #send({ conversation, payload, signal }: EndpointSendRequest): Promise<string> {
    const message = formatOutboundSegments(payload);
    const { action, params } = buildSendAction(conversation, message);
    const data = readOnebot11Response<{ message_id?: number | string }>(await this.#rpc.call({ action, params, signal }));
    const rawId = data?.message_id;
    if ((typeof rawId !== 'number' && typeof rawId !== 'string') || String(rawId).trim() === '' || (typeof rawId === 'number' && !Number.isFinite(rawId))) {
      throw new EndpointDeliveryError('delivery_unconfirmed', 'Message delivery is unconfirmed: platform returned no message_id', 'unknown');
    }
    const messageId = String(rawId);
    this.#logger.debug(formatCompact({
      op: 'onebot11_send',
      endpoint: this.#options.config.id,
      target: `${conversation.kind}:${conversation.id}`,
      messageId,
    }));
    return messageId;
  }

  async #recallMessage(messageId: string, signal?: AbortSignal): Promise<void> {
    if (!messageId) return;
    await this.#rpc.call({ action: 'delete_msg', params: { message_id: Number(messageId) }, signal }).then(readOnebot11Response);
  }


  #admitRaw(ev: OneBot11Event): void {
    const selfId = resolveOnebot11SelfId(ev.self_id);
    if (!this.#stopped && selfId) this[endpointSpec].reportSelfUserId(selfId);
    if (!isMessageEvent(ev)) {
      receiveOneBot11SideEvent(ev, {
        emit: (name, payload) => this[endpointSpec].events.emit(name, payload),
        endpointKey: this.#options.config.id,
        caller: { callApi: (action, params) => callOnebot11Client({ client: this, action, params }) },
        logger: this.#logger,
      });
      return;
    }
    const conversation = { ...onebot11InboundConversation(String(this.#options.id), ev), endpoint: this[endpointSpec].identity };
    const content = formatInboundContent(ev);
    const inbound = formatInboundMetadata(ev, this.#options.config.id);
    void this[endpointSpec].events.message({
      event: ev,
      ...(typeof ev.time === 'number' ? { platformSentAt: ev.time * 1000 } : {}),
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

  /** Best-effort 登录账号探测；失败仅 debug，不影响连接。 */
  async #probeSelfUserId(): Promise<void> {
    const selfId = await probeOnebot11SelfId(this, (error) => {
      this.#logger.debug(formatCompact({
        op: 'onebot11_get_login_info_failed',
        error: error instanceof Error ? error.message : String(error),
      }));
    });
    if (this.#stopped || this.#transportState !== 'open') return;
    if (selfId) this[endpointSpec].reportSelfUserId(selfId);
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
        if (this.#ws === ws) {
          this.#rpc.disconnect();
        }
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      });

      ws.on('open', () => {
        if (settled || this.#ws !== ws || !this.#lifecycle.started) return;
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

      ws.on('pong', () => {
        if (this.#ws === ws) this.#lifecycle.notifyHeartbeatAck();
      });
      ws.on('message', (data) => {
        if (this.#ws !== ws || ws.readyState !== 1 || !this.#lifecycle.started) return;
        this.#lifecycle.notifyHeartbeatAck();
        this.#rpc.receive(data, (ev) => this.ingest(ev as Parameters<Onebot11Client['ingest']>[0]));
      });

      ws.on('close', (code, reason) => {
        if (this.#ws !== ws) return;
        this.#ws = undefined;
        this.#rpc.disconnect();
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
        if (this.#ws !== ws) return;
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
