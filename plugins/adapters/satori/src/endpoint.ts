import { acceptHttpIngress } from 'imhelper';
/**
 * SatoriEndpoint — WebSocket and webhook lifecycle, outbound, admit.
 */
import {
  createEndpointSpecification, endpointSpec, type Endpoint, type EndpointSpecification,
  createEndpointLifecycle,
  type EndpointChannel,
  type EndpointConnectHandle,
  type EndpointControl,
  type EndpointGroup,
  type EndpointLifecycle,
  type EndpointManagement,
  type EndpointSendRequest,
} from 'zhin.js/adapter';
import type { HttpHost, HttpRouteRegistration } from '@zhin.js/host-http';
import { formatCompact, getAdapterLogger } from '@zhin.js/logger';
import type { CapabilityId } from 'zhin.js';
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
  satoriInboundConversation,
  type ResolvedSatoriWebhookConfig,
  type ResolvedSatoriWsConfig,
  type SatoriEventBody,
  type SatoriLogin,
  type SatoriSignal,
} from './protocol.js';
import { registerSatoriWebhookRoutes } from './webhook.js';
import { satoriClientOptions, forwardSatoriClientEvents, SatoriClient } from './client.js';
import {
  WS_OPEN,
  defaultCreateWebSocket,
  type CreateSatoriWebSocket,
  type SatoriWsSocket,
} from './ws.js';

export type SatoriApiCaller = typeof callSatoriApi;

export interface SatoriWsEndpointOptions {
  readonly signal?: AbortSignal;
  readonly id: CapabilityId;
  readonly config: ResolvedSatoriWsConfig;
  readonly createWebSocket?: CreateSatoriWebSocket;
  readonly callApi?: SatoriApiCaller;
}

export class SatoriWsEndpoint extends SatoriClient implements Endpoint {
  readonly [endpointSpec]: EndpointSpecification;
  #open = false;
  readonly #logger!: ReturnType<typeof getAdapterLogger>;

  readonly #options: SatoriWsEndpointOptions;
  readonly #lifecycle: EndpointLifecycle;
  #ws: SatoriWsSocket | null = null;
  #lastSn: number | undefined;
  readonly #management: EndpointManagement;
  readonly #control: EndpointControl = Object.freeze<EndpointControl>({
    recall: (message) => this.#recall(message.id, message.conversation.id),
  });

  constructor(options: SatoriWsEndpointOptions) {
    super(satoriClientOptions(options.config, options.callApi ?? callSatoriApi, () => ({
      baseUrl: options.config.baseUrl, platform: options.config.platform,
      userId: options.config.userId, token: options.config.token, signal: options.signal,
    })));
    this.#logger = getAdapterLogger('satori', options.config.id);
    this.#options = options;
    this.#management = createSatoriEndpointManagement(
      (resource, method, params) => this.call(resource, method, params),
    );
    this[endpointSpec] = createEndpointSpecification(this, {
      name: options.config.id,
      start: () => this.#start(), open: () => { this.#open = true; },
      close: () => { this.#open = false; }, stop: () => this.#stop(),
      send: request => this.#send(request),
      management: this.#management, control: this.#control,
    });
    forwardSatoriClientEvents(this, (name, payload) => {
      void this[endpointSpec].events.run(() => {
        if (!this.#open && !this.#lifecycle.started) return;
        void this[endpointSpec].events.platform(name, payload).catch(error => this.#warnPlatformEvent(name, error));
        if (name === 'event') this.#admitRaw(payload as SatoriEventBody);
      }).catch(error => this.#warnPlatformEvent(name, error));
    });
    const { config } = options;
    this.#lifecycle = createEndpointLifecycle({
      name: config.id,
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

  async #start(): Promise<void> {
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

  async #stop(): Promise<void> {
    this.#open = false;
    // 基座负责：清重连/心跳定时器、强关 ws、唤醒 stop-during-connect 竞态
    await this.#lifecycle.stop();
    this.#ws = null;
  }

  async #send({ conversation, payload }: EndpointSendRequest): Promise<string> {
    const content = formatSatoriOutbound(payload);
    const result = await this.call('message', 'create', {
      channel_id: conversation.id,
      content,
    });
    const msgId = extractCreatedMessageId(result);
    this.#logger.debug(formatCompact({
      op: 'satori_send',
      endpoint: this.#options.config.id,
      channel: conversation.id,
      messageId: msgId || undefined,
    }));
    return msgId ? formatMessageId(conversation.id, msgId) : '';
  }

  #admitRaw(body: SatoriEventBody): void {
    if (!matchesSatoriLogin(this.#options.config, body.login)) return;
    if (!isMessageEvent(body)) return;
    const conversation = { ...satoriInboundConversation(String(this.#options.id), body), endpoint: this[endpointSpec].identity };
    const content = formatInboundContent(body);
    const sender = resolveInboundSender(body);
    const selfId = this.#options.config.userId;
    const mentioned = isSelfMentioned(body, selfId);
    void this[endpointSpec].events.message({
      event: body,
      ...(typeof body.timestamp === 'number' ? { platformSentAt: body.timestamp } : {}),
      conversation,
      message: { conversation, id: body.message.id },
      content,
      sender,
      endpointId: this.#options.config.id,
      ...(mentioned ? { mentioned: true } : {}),
      metadata: Object.freeze({
        type: body.type,
        channelType: isPrivateChannelType(body) ? 'private' : 'group',
        sn: body.sn,
        platform: this.#options.config.platform,
      }),
    }).catch((err) => {
      this.#logger.warn(formatCompact({
        op: 'satori_gateway_receive_failed',
        channel: conversation.id,
        error: err instanceof Error ? err.message : String(err),
      }));
    });
  }

  async #recall(id: string, fallbackChannelId?: string): Promise<void> {
    const { channelId, messageId } = parseMessageRef(id);
    await this.call('message', 'delete', {
      channel_id: channelId || fallbackChannelId || '',
      message_id: messageId,
    });
  }

  #warnPlatformEvent(name: string, error: unknown): void {
    this.#logger.warn(formatCompact({
      op: 'satori_platform_event_failed',
      event: name,
      error: error instanceof Error ? error.message : String(error),
    }));
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
        if (this.#ws !== ws || !this.#lifecycle.started) return;
        this.#logger.debug(formatCompact({ mode: 'ws' }));
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
        if (this.#ws !== ws || !this.#lifecycle.started) return;
        try {
          const raw = typeof data === 'string'
            ? data
            : Buffer.isBuffer(data)
              ? data.toString('utf8')
              : String(data ?? '');
          const signal = JSON.parse(raw) as SatoriSignal;
          this.#handleSignal(signal);
        } catch (error) {
          this.#logger.warn(formatCompact({
            op: 'ws_parse_error',
            endpoint: config.id,
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
        this.#logger.warn(formatCompact({
          op: 'ws_error',
          endpoint: config.id,
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
      void this[endpointSpec].events.platform('pong', signal).catch((error) => {
        this.#logger.warn(formatCompact({
          op: 'satori_platform_event_failed',
          event: 'pong',
          error: error instanceof Error ? error.message : String(error),
        }));
      });
      return;
    }
    if (signal.op === SatoriOpcode.READY && signal.body?.logins) {
      const logins = signal.body.logins as SatoriLogin[];
      const login = logins.find(candidate => matchesSatoriLogin(this.#options.config, candidate));
      if (login?.user?.id) this[endpointSpec].reportSelfUserId(login.user.id);
      void this[endpointSpec].events.platform('ready', signal).catch((error) => {
        this.#logger.warn(formatCompact({
          op: 'satori_platform_event_failed',
          event: 'ready',
          error: error instanceof Error ? error.message : String(error),
        }));
      });
      if (!login) {
        this.#logger.warn(formatCompact({ op: 'ready', ok: false, error: 'missing platform/user' }));
      }
      return;
    }
    if (signal.op === SatoriOpcode.EVENT && signal.body) {
      const body = signal.body;
      void this[endpointSpec].events.run(() => {
        if (typeof body.sn === 'number') this.#lastSn = body.sn;
        this.#receive(body as SatoriEventBody);
      }).catch(error => this.#warnPlatformEvent('event', error));
    }
  }

  #sendSignal(op: number, body?: Record<string, unknown>): void {
    if (!this.#ws || this.#ws.readyState !== WS_OPEN) return;
    this.#ws.send(JSON.stringify({ op, body: body ?? {} }));
  }

  #receive(body: SatoriEventBody): void {
    if (!matchesSatoriLogin(this.#options.config, body.login)) return;
    this[endpointSpec].reportSelfUserId(this.#options.config.userId);
    this.ingest(body as Parameters<SatoriClient['ingest']>[0]);
  }

}

export interface SatoriWebhookEndpointOptions {
  readonly signal?: AbortSignal;
  readonly id: CapabilityId;
  readonly http: HttpHost;
  readonly config: ResolvedSatoriWebhookConfig;
  readonly callApi?: SatoriApiCaller;
}

export class SatoriWebhookEndpoint extends SatoriClient implements Endpoint {
  readonly [endpointSpec]: EndpointSpecification;
  #open = false;
  readonly #logger!: ReturnType<typeof getAdapterLogger>;

  readonly #options: SatoriWebhookEndpointOptions;
  #routeReleases: HttpRouteRegistration[] = [];
  #started = false;
  readonly #management: EndpointManagement;
  readonly #control: EndpointControl = Object.freeze<EndpointControl>({
    recall: (message) => this.#recall(message.id, message.conversation.id),
  });

  constructor(options: SatoriWebhookEndpointOptions) {
    super(satoriClientOptions(options.config, options.callApi ?? callSatoriApi, () => ({
      baseUrl: options.config.baseUrl, platform: options.config.platform,
      userId: options.config.userId, token: options.config.token, signal: options.signal,
    })));
    this.#logger = getAdapterLogger('satori', options.config.id);
    this.#options = options;
    this.#management = createSatoriEndpointManagement(
      (resource, method, params) => this.call(resource, method, params),
    );
    this[endpointSpec] = createEndpointSpecification(this, {
      name: options.config.id,
      start: () => this.#start(), open: () => { this.#open = true; },
      close: () => { this.#open = false; }, stop: () => this.#stop(),
      send: request => this.#send(request),
      management: this.#management, control: this.#control,
    });
    forwardSatoriClientEvents(this, (name, payload) => {
      void this[endpointSpec].events.run(() => {
        if (!this.#started) return;
        void this[endpointSpec].events.platform(name, payload).catch(error => this.#warnPlatformEvent(name, error));
        if (name === 'event') this.#admitRaw(payload as SatoriEventBody);
      }).catch(error => this.#warnPlatformEvent(name, error));
    });
  }

  async #start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    if (!this.#options.config.token) {
      // 未配 token 时 webhook 无鉴权：任何人知道 path 即可注入假事件。
      this.#logger.warn(formatCompact({
        op: 'webhook_no_token',
        endpoint: this.#options.config.id,
        path: this.#options.config.path,
        hint: 'set token to authenticate Satori webhook callbacks',
      }));
    }
    const isOpen = () => this.#open;
    this.#routeReleases.push(...registerSatoriWebhookRoutes(this.#options.http, {
      config: this.#options.config,
      get isOpen() { return isOpen(); },
      acceptHttp: async (request, response) => {
        await acceptHttpIngress<SatoriEventBody>(request, response, body => {
          void this[endpointSpec].events.run(() => this.#receive(body))
            .catch(error => this.#warnPlatformEvent('event', error));
        });
      },
    }));
    this.#logger.info(formatCompact({
      op: 'listen',
      endpoint: this.#options.config.id,
      mode: 'webhook',
      path: this.#options.config.path,
    }));
  }

  async #stop(): Promise<void> {
    this.#open = false;
    for (const release of this.#routeReleases.splice(0)) release();
    this.#started = false;
    this.#logger.debug(formatCompact({
          op: 'disconnect',
    }));
  }

  async #send({ conversation, payload }: EndpointSendRequest): Promise<string> {
    const content = formatSatoriOutbound(payload);
    const result = await this.call('message', 'create', {
      channel_id: conversation.id,
      content,
    });
    const msgId = extractCreatedMessageId(result);
    this.#logger.debug(formatCompact({
      op: 'satori_send',
      endpoint: this.#options.config.id,
      channel: conversation.id,
      messageId: msgId || undefined,
    }));
    return msgId ? formatMessageId(conversation.id, msgId) : '';
  }

  #admitRaw(body: SatoriEventBody): void {
    if (!matchesSatoriLogin(this.#options.config, body.login)) return;
    if (!isMessageEvent(body)) return;
    const conversation = { ...satoriInboundConversation(String(this.#options.id), body), endpoint: this[endpointSpec].identity };
    const content = formatInboundContent(body);
    const sender = resolveInboundSender(body);
    const selfId = this.#options.config.userId;
    const mentioned = isSelfMentioned(body, selfId);
    void this[endpointSpec].events.message({
      event: body,
      ...(typeof body.timestamp === 'number' ? { platformSentAt: body.timestamp } : {}),
      conversation,
      message: { conversation, id: body.message.id },
      content,
      sender,
      endpointId: this.#options.config.id,
      ...(mentioned ? { mentioned: true } : {}),
      metadata: Object.freeze({
        type: body.type,
        channelType: isPrivateChannelType(body) ? 'private' : 'group',
        sn: body.sn,
        platform: this.#options.config.platform,
      }),
    }).catch((err) => {
      this.#logger.warn(formatCompact({
        op: 'satori_gateway_receive_failed',
        channel: conversation.id,
        error: err instanceof Error ? err.message : String(err),
      }));
    });
  }

  async #recall(id: string, fallbackChannelId?: string): Promise<void> {
    const { channelId, messageId } = parseMessageRef(id);
    await this.call('message', 'delete', {
      channel_id: channelId || fallbackChannelId || '',
      message_id: messageId,
    });
  }

  #warnPlatformEvent(name: string, error: unknown): void {
    this.#logger.warn(formatCompact({
      op: 'satori_platform_event_failed',
      event: name,
      error: error instanceof Error ? error.message : String(error),
    }));
  }

  #receive(body: SatoriEventBody): void {
    if (!matchesSatoriLogin(this.#options.config, body.login)) return;
    this[endpointSpec].reportSelfUserId(this.#options.config.userId);
    this.ingest(body as Parameters<SatoriClient['ingest']>[0]);
  }

}

function isPrivateChannelType(body: SatoriEventBody): boolean {
  const channel = body.channel ?? body.message?.channel;
  return channel?.type === 1;
}

/**
 * Satori guild id 是平台相关字符串（多数平台为雪花号，超
 * Number.MAX_SAFE_INTEGER）。Console 社交面只把 group_id 当 JSON 值透传、
 * 并以字符串回传给 listGroupMembers，因此保留原始字符串（仅按契约类型
 * 声明强转）是全链路最不丢信息的方案。
 */
function toGroupId(id: string): number {
  return id as unknown as number;
}

export type SatoriManagementApi = (
  resource: string,
  method: string,
  params: Record<string, unknown>,
) => Promise<unknown>;

interface SatoriListPage {
  readonly data?: unknown[];
  readonly next?: string;
}

/** Satori 分页列表（{data, next?}）聚合；兼容直接返回数组的实现。 */
async function listSatoriPages(
  api: SatoriManagementApi,
  resource: string,
  params: Record<string, unknown>,
): Promise<unknown[]> {
  const items: unknown[] = [];
  let next: string | undefined;
  do {
    const page = await api(resource, 'list', next ? { ...params, next } : params);
    if (Array.isArray(page)) {
      items.push(...page);
      break;
    }
    const typed = (page ?? {}) as SatoriListPage;
    if (Array.isArray(typed.data)) items.push(...typed.data);
    next = typeof typed.next === 'string' && typed.next ? typed.next : undefined;
  } while (next);
  return items;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};
}

/**
 * Satori endpoint 的 EndpointManagement 语义端口（ws / webhook 共用），
 * 数据走协议 API：guild.list / channel.list / guild-member.list。
 */
export function createSatoriEndpointManagement(api: SatoriManagementApi): EndpointManagement {
  return Object.freeze<EndpointManagement>({
    async listGroups(): Promise<readonly EndpointGroup[]> {
      const groups: EndpointGroup[] = [];
      for (const value of await listSatoriPages(api, 'guild', {})) {
        const guild = asRecord(value);
        if (guild.id == null) continue;
        groups.push({
          group_id: toGroupId(String(guild.id)),
          name: String(guild.name ?? guild.id),
        });
      }
      return groups;
    },
    async listChannels(): Promise<readonly EndpointChannel[]> {
      const channels: EndpointChannel[] = [];
      for (const value of await listSatoriPages(api, 'guild', {})) {
        const guild = asRecord(value);
        if (guild.id == null) continue;
        const guildId = String(guild.id);
        const guildName = String(guild.name ?? guildId);
        for (const channelValue of await listSatoriPages(api, 'channel', { guild_id: guildId })) {
          const channel = asRecord(channelValue);
          if (channel.id == null) continue;
          // Channel.type: 0=TEXT 1=DIRECT 2=CATEGORY 3=VOICE；缺省按 TEXT 处理
          if (channel.type != null && Number(channel.type) !== 0) continue;
          channels.push({
            id: String(channel.id),
            name: channel.name != null ? String(channel.name) : undefined,
            parent: { type: 'guild', id: guildId, name: guildName },
          });
        }
      }
      return channels;
    },
    async listGroupMembers(groupId: string): Promise<readonly unknown[]> {
      // 平台形状（GuildMember[]）原样返回
      return listSatoriPages(api, 'guild-member', { guild_id: groupId });
    },
  });
}

export type { CreateSatoriWebSocket, SatoriWsSocket } from './ws.js';

/** A transport connection may multiplex logins; this Endpoint admits only its selected account. */
function matchesSatoriLogin(config: { readonly platform: string; readonly userId: string }, login: SatoriLogin | undefined): boolean {
  return login?.platform === config.platform && login.user?.id === config.userId;
}
