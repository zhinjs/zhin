/**
 * OneBot12 WS client endpoint — outbound connect to OneBot implementation.
 */
import WebSocket from 'ws';
import { clearTimeout } from 'node:timers';
import {
  createEndpointLifecycle,
  type EndpointConnectHandle,
  type EndpointInstance,
  type EndpointLifecycle,
  type EndpointManagement,
  type EndpointSendRequest,
} from '@zhin.js/adapter';
import type { MessageGateway } from '@zhin.js/core/runtime';
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { CapabilityId } from '@zhin.js/plugin-runtime';
import { createOneBot12EndpointManagement } from './endpoint-management.js';
import {
  buildSendMessageParams,
  buildWsConnectOptions,
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
  readonly management: EndpointManagement = createOneBot12EndpointManagement(this);
  readonly #lifecycle: EndpointLifecycle;
  #ws?: OneBot12WsSocket;
  #requestId = 0;
  #pending = new Map<string, {
    resolve: (value: unknown) => void;
    reject: (err: Error) => void;
    timeout: NodeJS.Timeout;
  }>();
  #open = false;

  constructor(options: OneBot12WsEndpointOptions) {
    this.#options = options;
    const { config } = options;
    this.#lifecycle = createEndpointLifecycle({
      name: config.name,
      reconnect: {
        initialIntervalMs: config.reconnect_interval,
        // 固定间隔（multiplier 1、无抖动），对齐旧 reconnect_interval 语义
        multiplier: 1,
        maxIntervalMs: config.reconnect_interval,
        jitterMs: 0,
      },
      heartbeat: { intervalMs: config.heartbeat_interval },
    });
  }

  async start(): Promise<void> {
    if (this.#lifecycle.started) return;
    try {
      await this.#lifecycle.start((handle) => this.#connect(handle));
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

  open(): void {
    this.#open = true;
  }

  close(): void {
    this.#open = false;
  }

  async stop(): Promise<void> {
    this.#open = false;
    // 基座负责：清重连/心跳定时器、强关 ws、唤醒 stop-during-connect 竞态
    await this.#lifecycle.stop();
    for (const [, pending] of this.#pending) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('连接已关闭'));
    }
    this.#pending.clear();
    this.#ws = undefined;
  }

  async send({ conversation, payload }: EndpointSendRequest): Promise<string> {
    const materialized = await uploadOneBot12MediaSegments(
      payload,
      (action, params) => this.callApi(action, params),
      (error) => {
        logger.warn(formatCompact({
          op: 'onebot12_upload_failed',
          endpoint: this.#options.config.name,
          error: error instanceof Error ? error.message : String(error),
        }));
      },
    );
    const message = formatOutboundSegments(materialized);
    const params = buildSendMessageParams(conversation, message);
    const data = await this.#callAction('send_message', params) as { message_id?: string } | undefined;
    const messageId = data?.message_id ?? '';
    logger.debug(formatCompact({
      op: 'onebot12_send',
      endpoint: this.#options.config.name,
      kind: conversation.kind,
      conversationId: conversation.id,
      messageId,
    }));
    return messageId;
  }

  async recallMessage(messageId: string): Promise<void> {
    if (!messageId) return;
    await this.#callAction('delete_message', { message_id: messageId });
  }

  /** Public API for management surface / callers. */
  callApi(action: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return this.#callAction(action, params);
  }

  /** Test / internal: admit a parsed event when the endpoint is open. */
  admit(ev: OneBot12Event): void {
    if (!this.#open || !isMessageEvent(ev)) return;
    const conversation = onebot12InboundConversation(String(this.#options.id), ev);
    const content = formatInboundContent(ev);
    const nickname = senderNickname(ev);
    const mentioned = isBotMentioned(ev);
    void this.#options.gateway.receive({
      conversation,
      message: { conversation, id: ev.message_id },
      content,
      sender: senderUserId(ev),
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
        kind: conversation.kind,
        conversationId: conversation.id,
        error: err instanceof Error ? err.message : String(err),
      }));
    });
  }

  async #connect(handle: EndpointConnectHandle): Promise<void> {
    const { url, headers, safeUrl } = buildWsConnectOptions(this.#options.config);
    const create = this.#options.createWebSocket
      ?? ((connectUrl: string, options: OneBot12WsCreateOptions) =>
        new WebSocket(connectUrl, { headers: options.headers }) as unknown as OneBot12WsSocket);

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
        logger.debug(formatCompact({
          endpoint: this.#options.config.name,
          mode: 'ws',
          url: safeUrl,
        }));
        this.#lifecycle.startHeartbeat(() => {
          this.#callAction('get_status', {}).catch(() => {});
        });
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
        if (!settled) {
          settled = true;
          reject(new Error(`OneBot12 WS 关闭: ${codeNum} ${reasonStr}`));
        }
        // 断开日志与重连武装均由基座负责；仅曾 open 的连接才会武装重连，
        // 初始连接失败由 start() 的拒绝路径复位，不产生僵尸重连。
        handle.notifyClosed(`OneBot12 WS 关闭: ${codeNum} ${reasonStr || 'closed'}`);
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
}
