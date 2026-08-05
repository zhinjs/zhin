/**
 * NapCat reverse WSS endpoint — accepts inbound WebSocket from NapCat.
 */
import { clearInterval } from 'node:timers';
import type { EndpointInstance, EndpointManagement, EndpointSendRequest } from '@zhin.js/adapter';
import type { MessageGateway } from '@zhin.js/core/runtime';
import type { HttpHost, WsConnection } from '@zhin.js/host-http';
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { CapabilityId } from '@zhin.js/plugin-runtime';
import { createNapCatEndpointManagement } from './endpoint-management.js';
import { registerNapcatAgentEndpoint } from './napcat-agent-deps.js';
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
import {
  callNapCatWsAction,
  handleNapCatWsMessage,
  rejectAllPending,
  startNapCatHeartbeat,
} from './ws-transport.js';
import { NapCatWsEndpoint } from './ws-endpoint.js';
import {
  type NapCatPendingAction,
  type NapCatWsSocket,
} from './ws-types.js';
import { verifyNapCatAccessToken } from './wss-auth.js';

const logger = getLogger('napcat');

export interface NapCatWssEndpointOptions {
  readonly id: CapabilityId;
  readonly gateway: MessageGateway;
  readonly http: HttpHost;
  readonly config: NapCatWssConfig;
}

export class NapCatWssEndpoint implements EndpointInstance {
  readonly #options: NapCatWssEndpointOptions;
  readonly #inboundDeduper = new InboundMessageDeduper();
  readonly management: EndpointManagement = createNapCatEndpointManagement(this);
  #ws?: NapCatWsSocket;
  #wsRelease?: () => void;
  #heartbeatTimer?: NodeJS.Timeout;
  #requestId = { value: 0 };
  #pending = new Map<string, NapCatPendingAction>();
  #open = false;
  #started = false;
  #unregisterAgent?: () => void;

  constructor(options: NapCatWssEndpointOptions) {
    this.#options = options;
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    this.#unregisterAgent = registerNapcatAgentEndpoint(
      this.#options.config.name,
      this as unknown as NapCatWsEndpoint,
    );
    const handle = this.#options.http.ws(this.#options.config.path);
    this.#wsRelease = handle.onConnection((connection) => {
      this.#acceptConnection(connection);
    });
    logger.info(formatCompact({
      op: 'listen',
      endpoint: this.#options.config.name,
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
    this.#unregisterAgent?.();
    this.#unregisterAgent = undefined;
    this.#wsRelease?.();
    this.#wsRelease = undefined;
    if (this.#heartbeatTimer) {
      clearInterval(this.#heartbeatTimer);
      this.#heartbeatTimer = undefined;
    }
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
    this.#started = false;
  }

  async send({ conversation, payload }: EndpointSendRequest): Promise<string> {
    const message = formatOutboundSegments(payload);
    const { action, params } = buildSendAction(napcatOutboundTarget(conversation), message);
    const data = await this.callApi(action, params) as { message_id?: number | string } | undefined;
    return data?.message_id != null ? String(data.message_id) : '';
  }

  async recallMessage(messageId: string): Promise<void> {
    if (!messageId) return;
    await this.callApi('delete_msg', { message_id: Number(messageId) });
  }

  callApi(action: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return callNapCatWsAction(this.#ws, this.#pending, this.#requestId, action, params);
  }

  admit(ev: NapCatEvent): void {
    if (!this.#open || !isMessageEvent(ev)) return;
    if (isSelfMessage(ev)) return;
    const msgId = String(ev.message_id);
    if (!this.#inboundDeduper.shouldProcess(msgId)) return;
    if (Array.isArray(ev.message) || typeof ev.message === 'string') {
      ev = { ...ev, message: normalizeMessage(ev.message) };
    }
    const conversation = napcatInboundConversation(String(this.#options.id), ev);
    const nickname = senderNickname(ev);
    const mentioned = isNapCatBotMentioned(ev);
    void this.#options.gateway.receive({
      conversation,
      message: { conversation, id: msgId },
      content: formatInboundContent(ev),
      sender: senderUserId(ev),
      metadata: Object.freeze({
        message_type: ev.message_type,
        user_id: ev.user_id != null ? String(ev.user_id) : undefined,
        group_id: ev.group_id != null ? String(ev.group_id) : undefined,
        endpoint: this.#options.config.name,
        time: ev.time,
        self_id: ev.self_id != null ? String(ev.self_id) : undefined,
        role: ev.sender?.role,
        ...(nickname ? { nickname } : {}),
        ...(mentioned ? { mentioned: true } : {}),
      }),
    }).catch((err) => {
      logger.warn(formatCompact({
        op: 'napcat_gateway_receive_failed',
        target: `${conversation.kind}:${conversation.id}`,
        error: err instanceof Error ? err.message : String(err),
      }));
    });
  }

  #acceptConnection(connection: WsConnection): void {
    if (!verifyNapCatAccessToken(this.#options.config.access_token, connection.request)) {
      connection.socket.close(4003, 'Unauthorized');
      return;
    }
    const socket = connection.socket as unknown as NapCatWsSocket;
    if (this.#ws) {
      try {
        this.#ws.close();
      } catch {
        /* ignore */
      }
    }
    this.#ws = socket;
    this.#heartbeatTimer = startNapCatHeartbeat(
      this.#ws,
      this.#options.config.heartbeat_interval,
      this.#heartbeatTimer,
    );
    socket.on('message', (data) => {
      handleNapCatWsMessage(data, {
        endpointName: this.#options.config.name,
        pending: this.#pending,
        admit: (event) => this.admit(event),
      });
    });
    socket.on('close', () => {
      if (this.#ws === socket) {
        this.#ws = undefined;
        if (this.#heartbeatTimer) {
          clearInterval(this.#heartbeatTimer);
          this.#heartbeatTimer = undefined;
        }
      }
    });
    logger.debug(formatCompact({
      endpoint: this.#options.config.name,
      mode: 'wss',
      peer: connection.request.socket.remoteAddress,
    }));
  }
}
