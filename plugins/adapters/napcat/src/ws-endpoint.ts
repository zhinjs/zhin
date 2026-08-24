import { Endpoint } from 'zhin.js/adapter';
/**
 * NapCat WS client endpoint — outbound connect to NapCat.
 */
import WebSocket from 'ws';
import {
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
  callNapCatWsAction,
  handleNapCatWsMessage,
  rejectAllPending,
} from './ws-transport.js';
import {
  type NapCatPendingAction,
  type NapCatWsCreateOptions,
  type NapCatWsSocket,
} from './ws-types.js';
import { createNapCatContentPort } from './onebot-get-msg.js';
import { NapcatClient } from './client.js';

export interface NapCatWsEndpointOptions {
  readonly id: CapabilityId;
  readonly config: NapCatWsConfig;
  readonly createWebSocket?: (
    url: string,
    options: NapCatWsCreateOptions,
  ) => NapCatWsSocket;
}

export class NapCatWsEndpoint extends Endpoint<NapcatClient> {
  readonly client = new NapcatClient((action, params) => this.#callApi(action, params));
  readonly #logger!: ReturnType<typeof getAdapterLogger>;

  readonly #options: NapCatWsEndpointOptions;
  readonly #inboundDeduper = new InboundMessageDeduper();
  readonly management: EndpointManagement = createNapCatEndpointManagement(this.client);
  readonly control: EndpointControl = createRecallEndpointControl((id) => this.recallMessage(id));
  readonly content = createNapCatContentPort((action, params) => this.client.callApi(action, params));
  readonly #lifecycle: EndpointLifecycle;
  #ws?: NapCatWsSocket;
  #requestId = { value: 0 };
  #pending = new Map<string, NapCatPendingAction>();
  #open = false;

  constructor(options: NapCatWsEndpointOptions) {
    super();
    this.#logger = getAdapterLogger('napcat', options.config.id);
    this.#options = options;
    this.#lifecycle = createEndpointLifecycle({
      name: options.config.id,
      // reconnect_interval 旧语义为固定间隔：multiplier 1 + 无 jitter + 不封顶
      reconnect: {
        initialIntervalMs: options.config.reconnect_interval,
        multiplier: 1,
        maxIntervalMs: Number.MAX_SAFE_INTEGER,
        jitterMs: 0,
      },
    });
  }

  async start(): Promise<void> {
    if (this.#lifecycle.started) return;
    await this.#lifecycle.start((handle) => this.#connect(handle));
  }

  open(): void {
    this.#open = true;
  }

  close(): void {
    this.#open = false;
  }

  async stop(): Promise<void> {
    this.#open = false;
    await this.#lifecycle.stop();
    rejectAllPending(this.#pending);
    this.#inboundDeduper.clear();
    if (this.#ws) {
      try {
        this.#ws.close();
      } catch {
        /* ignore */
      }
      this.#ws = undefined;
    }
  }

  async send({ conversation, payload }: EndpointSendRequest): Promise<string> {
    const message = formatOutboundSegments(payload);
    const { action, params } = buildSendAction(napcatOutboundTarget(conversation), message);
    const data = await this.client.callApi(action, params) as { message_id?: number | string } | undefined;
    const messageId = data?.message_id != null ? String(data.message_id) : '';
    this.#logger.debug(formatCompact({
      op: 'napcat_send',
      endpoint: this.#options.config.id,
      target: `${conversation.kind}:${conversation.id}`,
      messageId,
    }));
    return messageId;
  }

  async recallMessage(messageId: string): Promise<void> {
    if (!messageId) return;
    await this.client.callApi('delete_msg', { message_id: Number(messageId) });
  }

  #callApi(action: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return callNapCatWsAction(this.#ws, this.#pending, this.#requestId, action, params);
  }

  /** Test / internal: admit a parsed event when the endpoint is open. */
  admit(ev: NapCatEvent): void {
    if (!this.#open) return;
    void this.emitPlatform(napCatPlatformEventName(ev), ev).catch((error) => {
      this.#logger.warn(formatCompact({
        op: 'napcat_platform_event_failed',
        error: error instanceof Error ? error.message : String(error),
      }));
    });
    if (!isMessageEvent(ev)) {
      receiveNapCatSideEvent(
        (name, payload) => this.emit(name, payload),
        this.#options.config.id,
        this.client,
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
    const conversation = napcatInboundConversation(String(this.#options.id), ev);
    const content = formatInboundContent(ev);
    const nickname = senderNickname(ev);
    const mentioned = isNapCatBotMentioned(ev);
    void this.emit('message.receive', {
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

      ws.on('message', (data) => {
        handleNapCatWsMessage(data, {
          endpointId: this.#options.config.id,
          pending: this.#pending,
          admit: (event) => this.admit(event),
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
