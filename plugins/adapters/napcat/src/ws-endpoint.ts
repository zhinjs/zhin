import { EndpointDeliveryError } from '@zhin.js/im-contract';
/**
 * NapCat WS client endpoint — outbound connect to NapCat.
 */
import WebSocket from 'ws';
import {
  createEndpointSpecification, endpointSpec, type Endpoint, type EndpointSpecification,
  createRecallEndpointControl,
  createEndpointLifecycle,
  type EndpointConnectHandle,
  type EndpointControl,
  type EndpointLifecycle,
  type EndpointManagement,
  type EndpointSendRequest,
  type EndpointTransportState,
} from 'zhin.js/adapter';
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
  buildWsConnectOptions,
  formatInboundContent,
  formatOutboundSegments,
  isMessageEvent,
  napcatInboundConversation,
  napcatOutboundTarget,
  senderNickname,
  senderUserId,
  type NapCatEvent,
  type NapCatWsConfig,
} from './protocol.js';
import { receiveNapCatSideEvent } from './side-event-dispatch.js';
import {
  handleNapCatWsMessage,
  rejectAllPending,
} from './ws-transport.js';
import {
  type NapCatWsCreateOptions,
  type NapCatWsSocket,
} from './ws-types.js';
import { createNapCatContentPort } from './onebot-get-msg.js';
import { NapcatClient } from './client.js';

export interface NapCatWsEndpointOptions {
  readonly id: CapabilityId;
  readonly signal?: AbortSignal;
  readonly config: NapCatWsConfig;
  readonly createWebSocket?: (
    url: string,
    options: NapCatWsCreateOptions,
  ) => NapCatWsSocket;
}

export class NapCatWsEndpoint extends NapcatClient implements Endpoint {
  readonly [endpointSpec]: EndpointSpecification;
  readonly #logger!: ReturnType<typeof getAdapterLogger>;

  readonly #options: NapCatWsEndpointOptions;
  readonly #inboundDeduper = new InboundMessageDeduper();
  readonly #management: EndpointManagement = createNapCatEndpointManagement(this);
  readonly #control: EndpointControl = createRecallEndpointControl((id) => this.#recallMessage(id));
  readonly #content = createNapCatContentPort((action, params) => this.callApi(action, params));
  readonly #lifecycle: EndpointLifecycle;
  #open = false;

  constructor(options: NapCatWsEndpointOptions) {
    super(options.config, undefined, options.signal);
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
    this.#lifecycle = createEndpointLifecycle({
      name: options.config.id,
      heartbeat: { intervalMs: options.config.heartbeat_interval, watchdogMisses: 2 },
      // reconnect_interval 旧语义为固定间隔：multiplier 1 + 无 jitter + 不封顶
      reconnect: {
        initialIntervalMs: options.config.reconnect_interval,
        multiplier: 1,
        maxIntervalMs: Number.MAX_SAFE_INTEGER,
        jitterMs: 0,
      },
    });
  }

  get #transportState(): EndpointTransportState {
    return this.#lifecycle.state;
  }

  protected override get actionSocket(): NapCatWsSocket | undefined {
    return this.#lifecycle.state === 'open' ? this.transportSocket : undefined;
  }

  async #start(): Promise<void> {
    if (this.#lifecycle.started) return;
    await this.#lifecycle.start((handle) => this.#connect(handle));
  }

  #openEndpoint(): void {
    this.#open = true;
  }

  #close(): void {
    this.#open = false;
  }

  async #stop(): Promise<void> {
    this.#open = false;
    await this.#lifecycle.stop();
    rejectAllPending(this.pendingActions);
    this.#inboundDeduper.clear();
    if (this.transportSocket) {
      try {
        this.transportSocket.close();
      } catch {
        /* ignore */
      }
      this.transportSocket = undefined;
    }
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



  /** Test / internal: admit a parsed event when the endpoint is open. */
  #admit(ev: NapCatEvent): void {
    const nativeEvent = ev;
    if (!this.#open && !this.#lifecycle.started) return;
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
    const content = formatInboundContent(ev);
    const nickname = senderNickname(ev);
    const mentioned = isNapCatBotMentioned(ev);
    void this[endpointSpec].events.message({
      event: nativeEvent,
      ...(typeof nativeEvent.time === 'number' ? { platformSentAt: nativeEvent.time * 1000 } : {}),
      conversation,
      message: { conversation, id: msgId },
      content,
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

  async #connect(handle: EndpointConnectHandle): Promise<void> {
    const { url, headers, safeUrl } = buildWsConnectOptions(this.#options.config);
    const create = this.#options.createWebSocket
      ?? ((connectUrl: string, options: NapCatWsCreateOptions) =>
        new WebSocket(connectUrl, { headers: options.headers }) as unknown as NapCatWsSocket);

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const ws = create(url, { headers });
      this.transportSocket = ws;
      handle.onForceClose(() => {
        if (this.transportSocket === ws) {
          rejectAllPending(this.pendingActions);
        }
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      });

      ws.on('open', () => {
        if (settled || this.transportSocket !== ws || !this.#lifecycle.started) return;
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
        // stop-during-connect 竞态：已停止则不再武装心跳（基座 stop 已清理定时器）
        if (this.#lifecycle.started) {
          this.#lifecycle.startHeartbeat(() => {
            try {
              ws.ping?.();
            } catch {
              /* ignore */
            }
          }, this.#options.config.heartbeat_interval);
        }
        resolve();
      });

      ws.on('pong', () => {
        if (this.transportSocket === ws) this.#lifecycle.notifyHeartbeatAck();
      });
      ws.on('message', (data) => {
        if (this.transportSocket !== ws || ws.readyState !== 1 || !this.#lifecycle.started) return;
        this.#lifecycle.notifyHeartbeatAck();
        handleNapCatWsMessage(data, {
          endpointId: this.#options.config.id,
          pending: this.pendingActions,
          admit: (event) => this.ingest(event),
        });
      });

      ws.on('close', (code, reason) => {
        if (this.transportSocket !== ws) return;
        this.transportSocket = undefined;
        rejectAllPending(this.pendingActions);
        const reasonStr = typeof reason === 'string'
          ? reason
          : Buffer.isBuffer(reason)
            ? reason.toString()
            : String(reason ?? '');
        const codeNum = typeof code === 'number' ? code : Number(code ?? 0);
        const codeHint = codeNum === 1005
          ? ' [no status]'
          : codeNum === 1006
            ? ' [abnormal]'
            : '';
        this.#logger.warn(formatCompact({
          op: 'disconnect',
          code: codeNum,
          error: `${reasonStr || 'closed'}${codeHint}`,
          reconnect_ms: this.#options.config.reconnect_interval,
        }));
        // 基座语义：仅曾 open 的连接才武装重连；初始连接失败由 start() 的 catch 复位
        handle.notifyClosed(new Error(`NapCat WS closed: ${codeNum} ${reasonStr}`));
        if (!settled) {
          settled = true;
          reject(new Error(`NapCat WS closed: ${codeNum} ${reasonStr}`));
        }
      });

      ws.on('error', (err) => {
        if (this.transportSocket !== ws) return;
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

function napCatPlatformEventName(ev: NapCatEvent): string {
  return [ev.post_type, ev.message_type ?? ev.notice_type ?? ev.request_type, ev.sub_type]
    .filter(Boolean)
    .join('.');
}
