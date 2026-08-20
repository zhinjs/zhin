/**
 * OneBot12 reverse WSS endpoint — accepts inbound WebSocket from OneBot implementation.
 */
import { clearInterval } from 'node:timers';
import type { EndpointInstance, EndpointManagement, EndpointSendRequest } from 'zhin.js/adapter';
import type { MessageGateway } from '@zhin.js/core/runtime';
import type { HttpHost, WsConnection } from '@zhin.js/host-http';
import { formatCompact, getAdapterLogger } from '@zhin.js/logger';
import type { CapabilityId } from 'zhin.js/plugin-runtime';
import { createOneBot12EndpointManagement } from './endpoint-management.js';
import {
  buildSendMessageParams,
  formatInboundContent,
  formatOutboundSegments,
  isBotMentioned,
  isMessageEvent,
  onebot12InboundConversation,
  senderNickname,
  senderUserId,
  uploadOneBot12MediaSegments,
  type OneBot12ActionRequest,
  type OneBot12ActionResponse,
  type OneBot12Event,
  type OneBot12WssConfig,
} from './protocol.js';
import { verifyOneBotAccessToken } from './wss-auth.js';
import { type OneBot12WsSocket, WS_OPEN } from './ws-types.js';

export interface OneBot12WssEndpointOptions {
  readonly id: CapabilityId;
  readonly gateway: MessageGateway;
  readonly http: HttpHost;
  readonly config: OneBot12WssConfig;
}

export class OneBot12WssEndpoint implements EndpointInstance {
  readonly #logger!: ReturnType<typeof getAdapterLogger>;

  readonly #options: OneBot12WssEndpointOptions;
  readonly management: EndpointManagement = createOneBot12EndpointManagement(this);
  #ws?: OneBot12WsSocket;
  #wsRelease?: () => void;
  #heartbeatTimer?: NodeJS.Timeout;
  #requestId = 0;
  #pending = new Map<string, {
    resolve: (value: unknown) => void;
    reject: (err: Error) => void;
    timeout: NodeJS.Timeout;
  }>();
  #open = false;
  #started = false;

  constructor(options: OneBot12WssEndpointOptions) {
    this.#logger = getAdapterLogger('onebot12', options.config.id);
    this.#options = options;
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    if (!this.#options.config.access_token) {
      // wss 模式未配 access_token 时任何连接都会被放行（verifyOneBotAccessToken 直接 return true）
      this.#logger.warn(formatCompact({
        endpoint: this.#options.config.id,
        mode: 'wss',
        ok: false,
        error: 'missing access_token',
      }));
    }
    const handle = this.#options.http.ws(this.#options.config.path);
    this.#wsRelease = handle.onConnection((connection) => {
      this.#acceptConnection(connection);
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
    this.#started = false;
  }

  async send({ conversation, payload }: EndpointSendRequest): Promise<string> {
    const materialized = await uploadOneBot12MediaSegments(
      payload,
      (action, params) => this.callApi(action, params),
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
    const data = await this.#callAction('send_message', params) as { message_id?: string } | undefined;
    return data?.message_id ?? '';
  }

  async recallMessage(messageId: string): Promise<void> {
    if (!messageId) return;
    await this.#callAction('delete_message', { message_id: messageId });
  }

  /** Public API for management surface / callers. */
  callApi(action: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return this.#callAction(action, params);
  }

  admit(ev: OneBot12Event): void {
    if (!this.#open || !isMessageEvent(ev)) return;
    const conversation = onebot12InboundConversation(String(this.#options.id), ev);
    const nickname = senderNickname(ev);
    const mentioned = isBotMentioned(ev);
    void this.#options.gateway.receive({
      conversation,
      message: { conversation, id: ev.message_id },
      content: formatInboundContent(ev),
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

  #acceptConnection(connection: WsConnection): void {
    if (!verifyOneBotAccessToken(this.#options.config.access_token, connection.request)) {
      connection.socket.close(4003, 'Unauthorized');
      return;
    }
    const socket = connection.socket as unknown as OneBot12WsSocket;
    if (this.#ws) {
      try {
        this.#ws.close();
      } catch {
        /* ignore */
      }
    }
    this.#ws = socket;
    this.#startHeartbeat();
    socket.on('message', (data) => {
      this.#onMessage(data);
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
      endpoint: this.#options.config.id,
      mode: 'wss',
      peer: connection.request.socket.remoteAddress,
    }));
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
      this.#logger.warn(formatCompact({
        op: 'onebot12_parse_failed',
        endpoint: this.#options.config.id,
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
    if (this.#heartbeatTimer) clearInterval(this.#heartbeatTimer);
    this.#heartbeatTimer = setInterval(() => {
      this.#callAction('get_status', {}).catch(() => {});
    }, this.#options.config.heartbeat_interval);
  }
}
