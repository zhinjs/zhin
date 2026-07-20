/**
 * OneBot11 reverse WSS endpoint — accepts inbound WebSocket from OneBot implementation.
 */
import { clearInterval } from 'node:timers';
import type { EndpointInstance } from '@zhin.js/adapter';
import type { MessageGateway } from '@zhin.js/core/runtime';
import type { HttpHost, WsConnection } from '@zhin.js/host-http';
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { CapabilityId } from '@zhin.js/plugin-runtime';
import { registerOnebot11AgentEndpoint } from './onebot11-agent-deps.js';
import {
  buildSendAction,
  formatInboundContent,
  formatInboundMetadata,
  formatInboundTarget,
  formatOutboundSegments,
  isMessageEvent,
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

const logger = getLogger('onebot11');

export interface OneBot11WssEndpointOptions {
  readonly id: CapabilityId;
  readonly gateway: MessageGateway;
  readonly http: HttpHost;
  readonly config: OneBot11WssConfig;
}

export class OneBot11WssEndpoint implements EndpointInstance {
  readonly #options: OneBot11WssEndpointOptions;
  #ws?: OneBot11WsSocket;
  #wsRelease?: () => void;
  #heartbeatTimer?: NodeJS.Timeout;
  #requestId = { value: 0 };
  #pending = new Map<string, OneBot11PendingAction>();
  #open = false;
  #started = false;
  #unregisterAgent?: () => void;

  constructor(options: OneBot11WssEndpointOptions) {
    this.#options = options;
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    this.#unregisterAgent = registerOnebot11AgentEndpoint(
      this.#options.config.name,
      this as unknown as OneBot11WsEndpoint,
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

  async send({ target, payload }: { readonly target: string; readonly payload: unknown }): Promise<string> {
    const message = formatOutboundSegments(payload);
    const { action, params } = buildSendAction(target, message);
    const data = await this.callApi(action, params) as { message_id?: number | string } | undefined;
    return data?.message_id != null ? String(data.message_id) : '';
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
    const target = formatInboundTarget(ev);
    void this.#options.gateway.receive({
      adapter: this.#options.id,
      target,
      content: formatInboundContent(ev),
      sender: senderUserId(ev),
      id: String(ev.message_id),
      metadata: formatInboundMetadata(ev, this.#options.config.name),
    }).catch((err) => {
      logger.warn(formatCompact({
        op: 'onebot11_gateway_receive_failed',
        target,
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
    logger.debug(formatCompact({
      endpoint: this.#options.config.name,
      mode: 'wss',
      peer: connection.request.socket.remoteAddress,
    }));
  }
}
