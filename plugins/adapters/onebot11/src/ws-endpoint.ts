/**
 * OneBot11 WS client endpoint — outbound connect to OneBot implementation.
 */
import WebSocket from 'ws';
import {
  createEndpointLifecycle,
  type EndpointConnectHandle,
  type EndpointInstance,
  type EndpointLifecycle,
} from '@zhin.js/adapter';
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
  readonly #lifecycle: EndpointLifecycle;
  #ws?: OneBot11WsSocket;
  #requestId = { value: 0 };
  #pending = new Map<string, OneBot11PendingAction>();
  #open = false;
  #unregisterAgent?: () => void;

  constructor(options: OneBot11WsEndpointOptions) {
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
    // agent 注册/反注册是适配器专有依赖，留在适配器侧（见 endpoint-lifecycle 迁移指引）
    this.#unregisterAgent = registerOnebot11AgentEndpoint(this.#options.config.name, this);
    try {
      await this.#lifecycle.start((handle) => this.#connect(handle));
    } catch (err) {
      // start 失败必须清理现场（状态复位由基座保证），避免 agent 注册泄漏
      if (this.#ws) {
        try {
          this.#ws.close();
        } catch {
          /* ignore */
        }
        this.#ws = undefined;
      }
      this.#unregisterAgent?.();
      this.#unregisterAgent = undefined;
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
    this.#unregisterAgent?.();
    this.#unregisterAgent = undefined;
    rejectAllPending(this.#pending);
    this.#ws = undefined;
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

  async #connect(handle: EndpointConnectHandle): Promise<void> {
    const { url, headers, safeUrl } = buildWsConnectOptions(this.#options.config);
    const create = this.#options.createWebSocket
      ?? ((connectUrl: string, options: OneBot11WsCreateOptions) =>
        new WebSocket(connectUrl, { headers: options.headers }) as unknown as OneBot11WsSocket);

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
        this.#lifecycle.startHeartbeat(() => this.#ws?.ping?.());
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
        if (!settled) {
          settled = true;
          reject(new Error(`OneBot11 WS 关闭: ${codeNum} ${reasonStr}`));
        }
        // 断开日志与重连武装均由基座负责；仅曾 open 的连接才会武装重连，
        // 初始连接失败由 start() 的拒绝路径复位，不产生僵尸重连。
        handle.notifyClosed(`OneBot11 WS 关闭: ${codeNum} ${reasonStr || 'closed'}${codeHint}`);
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
}
