/**
 * OneBot12 WS client endpoint — outbound connect to OneBot implementation.
 */
import WebSocket from 'ws';
import { clearInterval, clearTimeout } from 'node:timers';
import type { EndpointInstance } from '@zhin.js/adapter';
import type { MessageGateway } from '@zhin.js/core/runtime';
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { CapabilityId } from '@zhin.js/plugin-runtime';
import {
  buildSendMessageParams,
  buildWsConnectOptions,
  formatInboundContent,
  formatInboundTarget,
  formatOutboundSegments,
  isBotMentioned,
  isMessageEvent,
  senderNickname,
  senderUserId,
  type OneBot12ActionRequest,
  type OneBot12ActionResponse,
  type OneBot12Event,
  type OneBot12WsConfig,
} from './protocol.js';
import {
  type OneBot12WsCreateOptions,
  type OneBot12WsSocket,
  WS_OPEN,
} from './ws-types.js';

const logger = getLogger('onebot12');

export interface OneBot12WsEndpointOptions {
  readonly id: CapabilityId;
  readonly gateway: MessageGateway;
  readonly config: OneBot12WsConfig;
  readonly createWebSocket?: (
    url: string,
    options: OneBot12WsCreateOptions,
  ) => OneBot12WsSocket;
}

export class OneBot12WsEndpoint implements EndpointInstance {
  readonly #options: OneBot12WsEndpointOptions;
  #ws?: OneBot12WsSocket;
  #reconnectTimer?: NodeJS.Timeout;
  #heartbeatTimer?: NodeJS.Timeout;
  #requestId = 0;
  #pending = new Map<string, {
    resolve: (value: unknown) => void;
    reject: (err: Error) => void;
    timeout: NodeJS.Timeout;
  }>();
  #open = false;
  #started = false;
  #stopping = false;

  constructor(options: OneBot12WsEndpointOptions) {
    this.#options = options;
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    this.#stopping = false;
    await this.#connect();
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
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = undefined;
    }
    if (this.#heartbeatTimer) {
      clearInterval(this.#heartbeatTimer);
      this.#heartbeatTimer = undefined;
    }
    for (const [, pending] of this.#pending) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('连接已关闭'));
    }
    this.#pending.clear();
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
    const params = buildSendMessageParams(target, message);
    const data = await this.#callAction('send_message', params) as { message_id?: string } | undefined;
    const messageId = data?.message_id ?? '';
    logger.debug(formatCompact({
      op: 'onebot12_send',
      endpoint: this.#options.config.name,
      target,
      messageId,
    }));
    return messageId;
  }

  /** Test / internal: admit a parsed event when the endpoint is open. */
  admit(ev: OneBot12Event): void {
    if (!this.#open || !isMessageEvent(ev)) return;
    const target = formatInboundTarget(ev);
    const content = formatInboundContent(ev);
    const nickname = senderNickname(ev);
    const mentioned = isBotMentioned(ev);
    void this.#options.gateway.receive({
      adapter: this.#options.id,
      target,
      content,
      sender: senderUserId(ev),
      id: ev.message_id,
      metadata: Object.freeze({
        detail_type: ev.detail_type,
        user_id: ev.user_id,
        group_id: ev.group_id,
        channel_id: ev.channel_id,
        guild_id: ev.guild_id,
        endpoint: this.#options.config.name,
        time: ev.time,
        ...(nickname ? { nickname } : {}),
        ...(mentioned ? { mentioned: true } : {}),
      }),
    }).catch((err) => {
      logger.warn(formatCompact({
        op: 'onebot12_gateway_receive_failed',
        target,
        error: err instanceof Error ? err.message : String(err),
      }));
    });
  }

  async #connect(): Promise<void> {
    const { url, headers, safeUrl } = buildWsConnectOptions(this.#options.config);
    const create = this.#options.createWebSocket
      ?? ((connectUrl: string, options: OneBot12WsCreateOptions) =>
        new WebSocket(connectUrl, { headers: options.headers }) as unknown as OneBot12WsSocket);

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const ws = create(url, { headers });
      this.#ws = ws;

      ws.on('open', () => {
        if (settled) return;
        settled = true;
        logger.debug(formatCompact({
          endpoint: this.#options.config.name,
          mode: 'ws',
          url: safeUrl,
        }));
        this.#startHeartbeat();
        resolve();
      });

      ws.on('message', (data) => {
        this.#onMessage(data);
      });

      ws.on('close', (code, reason) => {
        const reasonStr = typeof reason === 'string'
          ? reason
          : Buffer.isBuffer(reason)
            ? reason.toString()
            : String(reason ?? '');
        const codeNum = typeof code === 'number' ? code : Number(code ?? 0);
        logger.warn(formatCompact({
          op: 'disconnect',
          endpoint: this.#options.config.name,
          code: codeNum,
          error: reasonStr || 'closed',
          reconnect_ms: this.#options.config.reconnect_interval,
        }));
        if (!settled) {
          settled = true;
          reject(new Error(`OneBot12 WS 关闭: ${codeNum} ${reasonStr}`));
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

  #onMessage(data: unknown): void {
    try {
      const raw = typeof data === 'string'
        ? data
        : Buffer.isBuffer(data)
          ? data.toString()
          : data instanceof ArrayBuffer
            ? new TextDecoder().decode(data)
            : String(data ?? '');
      const msg = JSON.parse(raw) as OneBot12Event | OneBot12ActionResponse;
      if ('echo' in msg && typeof (msg as OneBot12ActionResponse).echo === 'string') {
        const resp = msg as OneBot12ActionResponse;
        const pending = this.#pending.get(resp.echo!);
        if (pending) {
          this.#pending.delete(resp.echo!);
          clearTimeout(pending.timeout);
          if (resp.status === 'ok') pending.resolve(resp.data);
          else pending.reject(new Error(`OneBot12 retcode=${resp.retcode}: ${resp.message}`));
        }
        return;
      }
      this.admit(msg as OneBot12Event);
    } catch (error) {
      logger.warn(formatCompact({
        op: 'onebot12_parse_failed',
        endpoint: this.#options.config.name,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  #callAction(action: string, params: Record<string, unknown>): Promise<unknown> {
    if (!this.#ws || this.#ws.readyState !== WS_OPEN) {
      return Promise.reject(new Error('WebSocket 未连接'));
    }
    const echo = `ob12_${++this.#requestId}`;
    const req: OneBot12ActionRequest = { action, params, echo };
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(echo);
        reject(new Error(`OneBot12 动作超时: ${action}`));
      }, 30_000);
      this.#pending.set(echo, { resolve, reject, timeout });
      this.#ws!.send(JSON.stringify(req));
    });
  }

  #startHeartbeat(): void {
    if (this.#heartbeatTimer) {
      clearInterval(this.#heartbeatTimer);
    }
    this.#heartbeatTimer = setInterval(() => {
      this.#callAction('get_status', {}).catch(() => {});
    }, this.#options.config.heartbeat_interval);
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
