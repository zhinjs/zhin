/**
 * OneBot11 WS client endpoint — outbound connect to OneBot implementation.
 */
import WebSocket from 'ws';
import { clearInterval, clearTimeout, setTimeout } from 'node:timers';
import type { EndpointInstance } from '@zhin.js/adapter';
import type { MessageGateway } from '@zhin.js/core/runtime';
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { CapabilityId } from '@zhin.js/plugin-runtime';
import { registerOnebot11AgentEndpoint } from './onebot11-agent-deps.js';
import {
  buildSendAction,
  buildWsConnectOptions,
  formatInboundContent,
  formatInboundMetadata,
  formatInboundTarget,
  formatOutboundSegments,
  isMessageEvent,
  senderUserId,
  type OneBot11Event,
  type OneBot11WsConfig,
} from './protocol.js';
import {
  callOneBot11WsAction,
  handleOneBot11WsMessage,
  rejectAllPending,
  startOneBot11Heartbeat,
} from './ws-transport.js';
import {
  type OneBot11PendingAction,
  type OneBot11WsCreateOptions,
  type OneBot11WsSocket,
} from './ws-types.js';

const logger = getLogger('onebot11');

export interface OneBot11WsEndpointOptions {
  readonly id: CapabilityId;
  readonly gateway: MessageGateway;
  readonly config: OneBot11WsConfig;
  readonly createWebSocket?: (
    url: string,
    options: OneBot11WsCreateOptions,
  ) => OneBot11WsSocket;
}

export class OneBot11WsEndpoint implements EndpointInstance {
  readonly #options: OneBot11WsEndpointOptions;
  #ws?: OneBot11WsSocket;
  #reconnectTimer?: NodeJS.Timeout;
  #heartbeatTimer?: NodeJS.Timeout;
  #requestId = { value: 0 };
  #pending = new Map<string, OneBot11PendingAction>();
  #open = false;
  #started = false;
  #stopping = false;
  #unregisterAgent?: () => void;

  constructor(options: OneBot11WsEndpointOptions) {
    this.#options = options;
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    this.#stopping = false;
    this.#unregisterAgent = registerOnebot11AgentEndpoint(this.#options.config.name, this);
    try {
      await this.#connect();
    } catch (err) {
      this.#started = false;
      throw err;
    }
  }

  open(): void {
    this.#open = true;
  }

  close(): void {
    this.#open = false;
  }

  async stop(): Promise<void> {
    this.#open = false;
    this.#stopping = true;
    this.#started = false;
    this.#unregisterAgent?.();
    this.#unregisterAgent = undefined;
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = undefined;
    }
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
    logger.debug(formatCompact({ op: 'disconnect', endpoint: this.#options.config.name }));
  }

  async send({ target, payload }: { readonly target: string; readonly payload: unknown }): Promise<string> {
    const message = formatOutboundSegments(payload);
    const { action, params } = buildSendAction(target, message);
    const data = await this.callApi(action, params) as { message_id?: number | string } | undefined;
    const messageId = data?.message_id != null ? String(data.message_id) : '';
    logger.debug(formatCompact({
      op: 'onebot11_send',
      endpoint: this.#options.config.name,
      target,
      messageId,
    }));
    return messageId;
  }

  /** Public API for agent tools / callers. */
  callApi(action: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return callOneBot11WsAction(this.#ws, this.#pending, this.#requestId, action, params);
  }

  async setTitle(
    groupId: number,
    userId: number,
    title: string,
    duration = -1,
  ): Promise<boolean> {
    await this.callApi('set_group_special_title', {
      group_id: groupId,
      user_id: userId,
      special_title: title,
      duration,
    });
    return true;
  }

  /** Test / internal: admit a parsed event when the endpoint is open. */
  admit(ev: OneBot11Event): void {
    if (!this.#open || !isMessageEvent(ev)) return;
    const target = formatInboundTarget(ev);
    const content = formatInboundContent(ev);
    void this.#options.gateway.receive({
      adapter: this.#options.id,
      target,
      content,
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

  async #connect(): Promise<void> {
    const { url, headers, safeUrl } = buildWsConnectOptions(this.#options.config);
    const create = this.#options.createWebSocket
      ?? ((connectUrl: string, options: OneBot11WsCreateOptions) =>
        new WebSocket(connectUrl, { headers: options.headers }) as unknown as OneBot11WsSocket);

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const ws = create(url, { headers });
      this.#ws = ws;

      ws.on('open', () => {
        if (settled) return;
        settled = true;
        if (!this.#options.config.access_token) {
          logger.warn(formatCompact({
            endpoint: this.#options.config.name,
            ok: false,
            error: 'missing access_token',
          }));
        }
        logger.debug(formatCompact({
          endpoint: this.#options.config.name,
          mode: 'ws',
          url: safeUrl,
        }));
        this.#heartbeatTimer = this.#stopping
          ? this.#heartbeatTimer
          : startOneBot11Heartbeat(
            this.#ws,
            this.#options.config.heartbeat_interval,
            this.#heartbeatTimer,
          );
        resolve();
      });

      ws.on('message', (data) => {
        handleOneBot11WsMessage(data, {
          endpointName: this.#options.config.name,
          pending: this.#pending,
          admit: (ev) => this.admit(ev),
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
        logger.warn(formatCompact({
          op: 'disconnect',
          endpoint: this.#options.config.name,
          code: codeNum,
          error: `${reasonStr || 'closed'}${codeHint}`,
          reconnect_ms: this.#options.config.reconnect_interval,
        }));
        if (!settled) {
          settled = true;
          reject(new Error(`OneBot11 WS 关闭: ${codeNum} ${reasonStr}`));
        }
        this.#scheduleReconnect();
      });

      ws.on('error', (err) => {
        const error = err instanceof Error ? err : new Error(String(err));
        logger.warn(formatCompact({
          op: 'ws_error',
          endpoint: this.#options.config.name,
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

  #scheduleReconnect(): void {
    if (this.#stopping || !this.#started || this.#reconnectTimer) return;
    const delay = this.#options.config.reconnect_interval;
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = undefined;
      void this.#connect().catch((err) => {
        logger.warn(formatCompact({
          op: 'reconnect',
          endpoint: this.#options.config.name,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }));
      });
    }, delay);
  }
}
