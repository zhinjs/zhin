/**
 * SatoriEndpoint — WebSocket and webhook lifecycle, outbound, admit.
 */
import {
  createEndpointLifecycle,
  type EndpointConnectHandle,
  type EndpointInstance,
  type EndpointLifecycle,
} from '@zhin.js/adapter';
import type { MessageGateway } from '@zhin.js/core/runtime';
import type { HttpHost, HttpRouteRegistration } from '@zhin.js/host-http';
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { CapabilityId } from '@zhin.js/plugin-runtime';
import {
  SatoriOpcode,
  buildWsUrl,
  callSatoriApi,
  extractCreatedMessageId,
  formatInboundContent,
  formatMessageId,
  formatSatoriOutbound,
  isMessageEvent,
  isSelfMentioned,
  parseMessageRef,
  resolveInboundSender,
  resolveInboundTarget,
  type ResolvedSatoriWebhookConfig,
  type ResolvedSatoriWsConfig,
  type SatoriApiOptions,
  type SatoriEventBody,
  type SatoriLogin,
  type SatoriSignal,
} from './protocol.js';
import { registerSatoriWebhookRoutes } from './webhook.js';
import {
  WS_OPEN,
  defaultCreateWebSocket,
  type CreateSatoriWebSocket,
  type SatoriWsSocket,
} from './ws.js';

const logger = getLogger('satori');

export type SatoriApiCaller = typeof callSatoriApi;

export interface SatoriWsEndpointOptions {
  readonly id: CapabilityId;
  readonly gateway: MessageGateway;
  readonly config: ResolvedSatoriWsConfig;
  readonly createWebSocket?: CreateSatoriWebSocket;
  readonly callApi?: SatoriApiCaller;
}

export class SatoriWsEndpoint implements EndpointInstance {
  readonly #options: SatoriWsEndpointOptions;
  readonly #lifecycle: EndpointLifecycle;
  #ws: SatoriWsSocket | null = null;
  #login: SatoriLogin | undefined;
  #lastSn: number | undefined;
  #open = false;

  constructor(options: SatoriWsEndpointOptions) {
    this.#options = options;
    const { config } = options;
    this.#lifecycle = createEndpointLifecycle({
      name: config.name,
      reconnect: {
        initialIntervalMs: 5_000,
        // 固定间隔（multiplier 1、无抖动），对齐旧 5s 固定重连语义
        multiplier: 1,
        maxIntervalMs: 5_000,
        jitterMs: 0,
      },
      heartbeat: {
        intervalMs: config.heartbeat_interval,
        // PONG 看门狗：连续 2 轮无回包，下一轮心跳由基座强关连接触发重连
        watchdogMisses: 2,
      },
    });
  }

  async start(): Promise<void> {
    try {
      await this.#lifecycle.start((handle) => this.#connect(handle));
    } catch (err) {
      // start 失败清理现场（状态复位由基座保证）
      if (this.#ws) {
        try {
          this.#ws.close();
        } catch {
          /* ignore */
        }
        this.#ws = null;
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
    this.#ws = null;
  }

  async send({ target, payload }: { readonly target: string; readonly payload: unknown }): Promise<string> {
    const content = formatSatoriOutbound(payload);
    const result = await this.#api('message', 'create', {
      channel_id: target,
      content,
    });
    const msgId = extractCreatedMessageId(result);
    logger.debug(formatCompact({
      op: 'satori_send',
      endpoint: this.#options.config.name,
      target,
      messageId: msgId || undefined,
    }));
    return msgId ? formatMessageId(target, msgId) : '';
  }

  /** Test / internal: admit a gateway event when the endpoint is open. */
  admit(body: SatoriEventBody): void {
    if (!this.#open) return;
    if (body.login && !this.#login) this.#login = body.login;
    if (!isMessageEvent(body)) return;
    const target = resolveInboundTarget(body);
    const content = formatInboundContent(body);
    const sender = resolveInboundSender(body);
    const messageId = formatMessageId(target, body.message.id);
    const selfId = this.#login?.user?.id ?? body.login?.user?.id;
    const mentioned = isSelfMentioned(body, selfId);
    void this.#options.gateway.receive({
      adapter: this.#options.id,
      target,
      content,
      sender,
      id: messageId,
      metadata: Object.freeze({
        type: body.type,
        channelType: isPrivateChannelType(body) ? 'private' : 'group',
        sn: body.sn,
        platform: this.#login?.platform,
        endpoint: this.#options.config.name,
        ...(mentioned ? { mentioned: true } : {}),
      }),
    }).catch((err) => {
      logger.warn(formatCompact({
        op: 'satori_gateway_receive_failed',
        target,
        error: err instanceof Error ? err.message : String(err),
      }));
    });
  }

  async recall(id: string): Promise<void> {
    const { channelId, messageId } = parseMessageRef(id);
    await this.#api('message', 'delete', {
      channel_id: channelId,
      message_id: messageId,
    });
  }

  /** Test helper: inject a READY login without a live socket. */
  setLogin(login: SatoriLogin): void {
    this.#login = login;
  }

  async #connect(handle: EndpointConnectHandle): Promise<void> {
    const { config } = this.#options;
    const createWs = this.#options.createWebSocket ?? defaultCreateWebSocket;
    const headers: Record<string, string> = {};
    if (config.token) headers.Authorization = `Bearer ${config.token}`;

    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = createWs(buildWsUrl(config.baseUrl, config.token), { headers });
      this.#ws = ws;
      handle.onForceClose(() => {
        try {
          ws.close();
        } catch {
          /* already closed */
        }
      });

      ws.on('open', () => {
        logger.debug(formatCompact({ endpoint: config.name, mode: 'ws' }));
        this.#sendSignal(SatoriOpcode.IDENTIFY, {
          token: config.token,
          sn: this.#lastSn,
        });
        this.#lifecycle.startHeartbeat(() => this.#sendSignal(SatoriOpcode.PING));
        if (!settled) {
          settled = true;
          resolve();
        }
      });

      ws.on('message', (data) => {
        try {
          const raw = typeof data === 'string'
            ? data
            : Buffer.isBuffer(data)
              ? data.toString('utf8')
              : String(data ?? '');
          const signal = JSON.parse(raw) as SatoriSignal;
          this.#handleSignal(signal);
        } catch (error) {
          logger.warn(formatCompact({
            op: 'ws_parse_error',
            endpoint: config.name,
            error: error instanceof Error ? error.message : String(error),
          }));
        }
      });

      ws.on('close', (code, reason) => {
        const reasonStr = typeof reason === 'string'
          ? reason
          : Buffer.isBuffer(reason)
            ? reason.toString('utf8')
            : String(reason ?? '');
        const numericCode = typeof code === 'number' ? code : 0;
        if (!settled) {
          settled = true;
          reject(new Error(`Satori WS closed: ${numericCode} ${reasonStr}`));
        }
        // 断开日志与重连武装均由基座负责；仅曾 open 的连接才会武装重连，
        // 初始连接失败由 start() 的拒绝路径复位。
        handle.notifyClosed(`Satori WS closed: ${numericCode} ${reasonStr || 'closed'}`);
      });

      ws.on('error', (error) => {
        logger.warn(formatCompact({
          op: 'ws_error',
          endpoint: config.name,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }));
        if (!settled) {
          settled = true;
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    });
  }

  #handleSignal(signal: SatoriSignal): void {
    if (signal.op === SatoriOpcode.PONG) {
      // 喂狗：复位基座看门狗计数
      this.#lifecycle.notifyHeartbeatAck();
      return;
    }
    if (signal.op === SatoriOpcode.READY && signal.body?.logins) {
      const logins = signal.body.logins as SatoriLogin[];
      this.#login = logins[0];
      if (!this.#login?.platform || !this.#login?.user?.id) {
        logger.warn(formatCompact({ op: 'ready', ok: false, error: 'missing platform/user' }));
      }
      return;
    }
    if (signal.op === SatoriOpcode.EVENT && signal.body) {
      if (typeof signal.body.sn === 'number') this.#lastSn = signal.body.sn;
      this.admit(signal.body as SatoriEventBody);
    }
  }

  #sendSignal(op: number, body?: Record<string, unknown>): void {
    if (!this.#ws || this.#ws.readyState !== WS_OPEN) return;
    this.#ws.send(JSON.stringify({ op, body: body ?? {} }));
  }

  #apiOptions(): SatoriApiOptions {
    return {
      baseUrl: this.#options.config.baseUrl,
      platform: this.#login?.platform ?? '',
      userId: this.#login?.user?.id ?? '',
      token: this.#options.config.token,
    };
  }

  #api(
    resource: string,
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const call = this.#options.callApi ?? callSatoriApi;
    return call(this.#apiOptions(), resource, method, params);
  }
}

export interface SatoriWebhookEndpointOptions {
  readonly id: CapabilityId;
  readonly gateway: MessageGateway;
  readonly http: HttpHost;
  readonly config: ResolvedSatoriWebhookConfig;
  readonly callApi?: SatoriApiCaller;
}

export class SatoriWebhookEndpoint implements EndpointInstance {
  readonly #options: SatoriWebhookEndpointOptions;
  #login: SatoriLogin | undefined;
  #routeReleases: HttpRouteRegistration[] = [];
  #open = false;
  #started = false;

  constructor(options: SatoriWebhookEndpointOptions) {
    this.#options = options;
  }

  /** Used by webhook handler. */
  get isOpen(): boolean {
    return this.#open;
  }

  get config(): ResolvedSatoriWebhookConfig {
    return this.#options.config;
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    if (!this.#options.config.token) {
      // 未配 token 时 webhook 无鉴权：任何人知道 path 即可注入假事件。
      logger.warn(formatCompact({
        op: 'webhook_no_token',
        endpoint: this.#options.config.name,
        path: this.#options.config.path,
        hint: 'set token to authenticate Satori webhook callbacks',
      }));
    }
    this.#routeReleases.push(...registerSatoriWebhookRoutes(this.#options.http, this));
    logger.info(formatCompact({
      op: 'listen',
      endpoint: this.#options.config.name,
      mode: 'webhook',
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
    for (const release of this.#routeReleases.splice(0)) release();
    this.#started = false;
    logger.debug(formatCompact({
      op: 'disconnect',
      endpoint: this.#options.config.name,
    }));
  }

  async send({ target, payload }: { readonly target: string; readonly payload: unknown }): Promise<string> {
    const content = formatSatoriOutbound(payload);
    const result = await this.#api('message', 'create', {
      channel_id: target,
      content,
    });
    const msgId = extractCreatedMessageId(result);
    logger.debug(formatCompact({
      op: 'satori_send',
      endpoint: this.#options.config.name,
      target,
      messageId: msgId || undefined,
    }));
    return msgId ? formatMessageId(target, msgId) : '';
  }

  admit(body: SatoriEventBody): void {
    if (!this.#open) return;
    if (body.login && !this.#login) this.#login = body.login;
    if (!isMessageEvent(body)) return;
    const target = resolveInboundTarget(body);
    const content = formatInboundContent(body);
    const sender = resolveInboundSender(body);
    const messageId = formatMessageId(target, body.message.id);
    const selfId = this.#login?.user?.id ?? body.login?.user?.id;
    const mentioned = isSelfMentioned(body, selfId);
    void this.#options.gateway.receive({
      adapter: this.#options.id,
      target,
      content,
      sender,
      id: messageId,
      metadata: Object.freeze({
        type: body.type,
        channelType: isPrivateChannelType(body) ? 'private' : 'group',
        sn: body.sn,
        platform: this.#login?.platform,
        endpoint: this.#options.config.name,
        ...(mentioned ? { mentioned: true } : {}),
      }),
    }).catch((err) => {
      logger.warn(formatCompact({
        op: 'satori_gateway_receive_failed',
        target,
        error: err instanceof Error ? err.message : String(err),
      }));
    });
  }

  async recall(id: string): Promise<void> {
    const { channelId, messageId } = parseMessageRef(id);
    await this.#api('message', 'delete', {
      channel_id: channelId,
      message_id: messageId,
    });
  }

  /** Test helper: inject login without a live webhook push. */
  setLogin(login: SatoriLogin): void {
    this.#login = login;
  }

  #apiOptions(): SatoriApiOptions {
    return {
      baseUrl: this.#options.config.baseUrl,
      platform: this.#login?.platform ?? '',
      userId: this.#login?.user?.id ?? '',
      token: this.#options.config.token,
    };
  }

  #api(
    resource: string,
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const call = this.#options.callApi ?? callSatoriApi;
    return call(this.#apiOptions(), resource, method, params);
  }
}

function isPrivateChannelType(body: SatoriEventBody): boolean {
  const channel = body.channel ?? body.message?.channel;
  return channel?.type === 1;
}

export type { CreateSatoriWebSocket, SatoriWsSocket } from './ws.js';
