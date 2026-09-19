import { Endpoint } from 'zhin.js/adapter';
/**
 * NapCat reverse WSS endpoint — accepts inbound WebSocket from NapCat.
 */
import {
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
  callNapCatWsAction,
  handleNapCatWsMessage,
  rejectAllPending,
} from './ws-transport.js';
import { NapCatWsEndpoint } from './ws-endpoint.js';
import {
  type NapCatPendingAction,
  type NapCatWsSocket,
} from './ws-types.js';
import { verifyNapCatAccessToken } from './wss-auth.js';

export interface NapCatWssEndpointOptions {
  readonly id: CapabilityId;
  readonly http: HttpHost;
  readonly config: NapCatWssConfig;
}

export class NapCatWssEndpoint extends Endpoint<NapcatClient> {
  readonly client = new NapcatClient((action, params) => this.#callApi(action, params));
  readonly #logger!: ReturnType<typeof getAdapterLogger>;

  readonly #options: NapCatWssEndpointOptions;
  readonly #inboundDeduper = new InboundMessageDeduper();
  readonly management: EndpointManagement = createNapCatEndpointManagement(this.client);
  readonly control: EndpointControl = createRecallEndpointControl((id) => this.recallMessage(id));
  readonly content = createNapCatContentPort((action, params) => this.client.callApi(action, params));
  readonly #connectionLifecycle: EndpointLifecycle;
  #ws?: NapCatWsSocket;
  #wsRelease?: () => void;
  #connectionTask = Promise.resolve();
  #requestId = { value: 0 };
  #pending = new Map<string, NapCatPendingAction>();
  #open = false;
  #started = false;

  constructor(options: NapCatWssEndpointOptions) {
    super();
    this.#logger = getAdapterLogger('napcat', options.config.id);
    this.#options = options;
    this.#connectionLifecycle = createEndpointLifecycle({
      name: `${options.config.id}:inbound`,
      reconnect: false,
    });
  }

  async start(): Promise<void> {
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

  open(): void {
    this.#open = true;
  }

  close(): void {
    this.#open = false;
  }

  async stop(): Promise<void> {
    this.#open = false;
    this.#wsRelease?.();
    this.#wsRelease = undefined;
    await this.#connectionTask;
    await this.#connectionLifecycle.stop();
    rejectAllPending(this.#pending);
    this.#inboundDeduper.clear();
    this.#ws = undefined;
    this.#started = false;
  }

  async send({ conversation, payload }: EndpointSendRequest): Promise<string> {
    const message = formatOutboundSegments(payload);
    const { action, params } = buildSendAction(napcatOutboundTarget(conversation), message);
    const data = await this.client.callApi(action, params) as { message_id?: number | string } | undefined;
    return data?.message_id != null ? String(data.message_id) : '';
  }

  async recallMessage(messageId: string): Promise<void> {
    if (!messageId) return;
    await this.client.callApi('delete_msg', { message_id: Number(messageId) });
  }

  #callApi(action: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return callNapCatWsAction(this.#ws, this.#pending, this.#requestId, action, params);
  }

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
    const nickname = senderNickname(ev);
    const mentioned = isNapCatBotMentioned(ev);
    void this.emit('message.receive', {
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
    if (!verifyNapCatAccessToken(this.#options.config.access_token, connection.request)) {
      connection.socket.close(4003, 'Unauthorized');
      return;
    }
    const socket = connection.socket as unknown as NapCatWsSocket;
    await this.#connectionLifecycle.stop();
    await this.#connectionLifecycle.start(async (lifecycleHandle) => {
      this.#ws = socket;
      lifecycleHandle.onForceClose(() => {
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
      socket.on('message', (data) => {
        this.#connectionLifecycle.notifyHeartbeatAck();
        handleNapCatWsMessage(data, {
          endpointId: this.#options.config.id,
          pending: this.#pending,
          admit: (event) => this.admit(event),
        });
      });
      socket.on('close', () => {
        if (this.#ws === socket) this.#ws = undefined;
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
