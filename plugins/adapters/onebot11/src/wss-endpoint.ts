/**
 * OneBot11 reverse WSS endpoint — accepts inbound WebSocket from OneBot implementation.
 */
import { clearInterval } from 'node:timers';
import type { EndpointInstance, EndpointManagement, EndpointSendRequest } from '@zhin.js/adapter';
import type { MessageGateway } from '@zhin.js/core/runtime';
import type { HttpHost, WsConnection } from '@zhin.js/host-http';
import { formatCompact, getAdapterLogger } from '@zhin.js/logger';
import type { CapabilityId } from '@zhin.js/plugin-runtime';
import { createOneBot11EndpointManagement } from './endpoint-management.js';
import { registerOnebot11AgentEndpoint } from './onebot11-agent-deps.js';
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
import { verifyOneBotAccessToken } from './wss-auth.js';
import {
  callOneBot11WsAction,
  handleOneBot11WsMessage,
  rejectAllPending,
  startOneBot11Heartbeat,
} from './ws-transport.js';
import { OneBot11WsEndpoint } from './ws-endpoint.js';
import {
  type OneBot11PendingAction,
  type OneBot11WsSocket,
} from './ws-types.js';

export interface OneBot11WssEndpointOptions {
  readonly id: CapabilityId;
  readonly gateway: MessageGateway;
  readonly http: HttpHost;
  readonly config: OneBot11WssConfig;
}

export class OneBot11WssEndpoint implements EndpointInstance {
  readonly #logger!: ReturnType<typeof getAdapterLogger>;

  readonly #options: OneBot11WssEndpointOptions;
  readonly management: EndpointManagement = createOneBot11EndpointManagement(this);
  #ws?: OneBot11WsSocket;
  #wsRelease?: () => void;
  #heartbeatTimer?: NodeJS.Timeout;
  #requestId = { value: 0 };
  #pending = new Map<string, OneBot11PendingAction>();
  #open = false;
  #started = false;
  #unregisterAgent?: () => void;

  constructor(options: OneBot11WssEndpointOptions) {
    this.#logger = getAdapterLogger('onebot11', options.config.name);
    this.#options = options;
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    if (!this.#options.config.access_token) {
      // wss 模式未配 access_token 时任何连接都会被放行（verifyOneBotAccessToken 直接 return true）
      this.#logger.warn(formatCompact({
        endpoint: this.#options.config.name,
        mode: 'wss',
        ok: false,
        error: 'missing access_token',
      }));
    }
    this.#unregisterAgent = registerOnebot11AgentEndpoint(
      this.#options.config.name,
      this as unknown as OneBot11WsEndpoint,
    );
    const handle = this.#options.http.ws(this.#options.config.path);
    this.#wsRelease = handle.onConnection((connection) => {
      this.#acceptConnection(connection);
    });
    this.#logger.info(formatCompact({
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
    const { action, params } = buildSendAction(conversation, message);
    const data = await this.callApi(action, params) as { message_id?: number | string } | undefined;
    return data?.message_id != null ? String(data.message_id) : '';
  }

  async recallMessage(messageId: string): Promise<void> {
    if (!messageId) return;
    await this.callApi('delete_msg', { message_id: Number(messageId) });
  }

  callApi(action: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return callOneBot11WsAction(this.#ws, this.#pending, this.#requestId, action, params);
  }

  async setTitle(groupId: number, userId: number, title: string, duration = -1): Promise<boolean> {
    await this.callApi('set_group_special_title', {
      group_id: groupId,
      user_id: userId,
      special_title: title,
      duration,
    });
    return true;
  }

  admit(ev: OneBot11Event): void {
    if (!this.#open || !isMessageEvent(ev)) return;
    const conversation = onebot11InboundConversation(String(this.#options.id), ev);
    void this.#options.gateway.receive({
      conversation,
      message: { conversation, id: String(ev.message_id) },
      content: formatInboundContent(ev),
      sender: {
        id: senderUserId(ev),
        name: senderDisplayName(ev) || undefined,
        ...(ev.sender?.role ? { roles: [ev.sender.role] } : {}),
      },
      metadata: formatInboundMetadata(ev, this.#options.config.name),
    }).catch((err) => {
      this.#logger.warn(formatCompact({
        op: 'onebot11_gateway_receive_failed',
        target: `${conversation.kind}:${conversation.id}`,
        error: err instanceof Error ? err.message : String(err),
      }));
    });
  }

  #acceptConnection(connection: WsConnection): void {
    if (!verifyOneBotAccessToken(this.#options.config.access_token, connection.request)) {
      connection.socket.close(4003, 'Unauthorized');
      return;
    }
    const socket = connection.socket as unknown as OneBot11WsSocket;
    if (this.#ws) {
      try {
        this.#ws.close();
      } catch {
        /* ignore */
      }
    }
    this.#ws = socket;
    this.#heartbeatTimer = startOneBot11Heartbeat(
      this.#ws,
      this.#options.config.heartbeat_interval,
      this.#heartbeatTimer,
    );
    socket.on('message', (data) => {
      handleOneBot11WsMessage(data, {
        endpointName: this.#options.config.name,
        pending: this.#pending,
        admit: (ev) => this.admit(ev),
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
    this.#logger.debug(formatCompact({
      endpoint: this.#options.config.name,
      mode: 'wss',
      peer: connection.request.socket.remoteAddress,
    }));
  }
}
