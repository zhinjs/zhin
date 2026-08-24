import { Endpoint } from 'zhin.js/adapter';
/**
 * QQ endpoints — lifecycle, outbound, admit, agent tool surface.
 */
import {
  createRecallEndpointControl,
  type EndpointControl,
  type EndpointChannel,
  type EndpointManagement,
  type EndpointSendRequest,
} from 'zhin.js/adapter';
import type { HttpHost } from '@zhin.js/host-http';
import { formatCompact, getAdapterLogger, truncatePreview } from '@zhin.js/logger';
import type { CapabilityId } from 'zhin.js';
import { formatOutbound } from './outbound.js';
import {
  formatInboundContent,
  parseCompoundMessageId,
  qqInboundConversation,
  qqOutboundKind,
  resolveOutboundMessageId,
  senderDisplayName,
  type QqInboundMessage,
  type ResolvedQqHttpConfig,
  type ResolvedQqWebsocketConfig,
} from './protocol.js';
import {
  defaultCreateHttpBot,
  registerQqWebhookRoutes,
  type CreateQqHttpBot,
  type QqHttpBotTransport,
} from './webhook.js';
import {
  bindQqBotInboundEvents,
  defaultCreateBot,
  normalizeQqMessage,
  type CreateQqBot,
  type QqBotTransport,
} from './ws.js';
import {
  bindQqBotSideEvents,
  receiveQqSideEvent,
  type QqSideEventCaller,
} from './side-event-dispatch.js';

export type { CreateQqBot, QqBotTransport } from './ws.js';
export type { CreateQqHttpBot, QqHttpBotTransport } from './webhook.js';

export interface QqEndpointOptions {
  readonly id: CapabilityId;
  readonly config: ResolvedQqWebsocketConfig;
  readonly createBot?: CreateQqBot;
}

export class QqWebsocketEndpoint extends Endpoint<QqBotTransport> {
  readonly #logger!: ReturnType<typeof getAdapterLogger>;

  readonly #options: QqEndpointOptions;
  readonly #createBot: CreateQqBot;
  #bot: QqBotTransport | null = null;
  #open = false;
  #started = false;
  readonly management: EndpointManagement = createQqEndpointManagement(() => this.#requireBot());
  readonly control: EndpointControl = createRecallEndpointControl((id) => this.recallMessage(id));

  constructor(options: QqEndpointOptions) {
    super();
    this.#logger = getAdapterLogger('qq', options.config.id);
    this.#options = options;
    this.#createBot = options.createBot ?? defaultCreateBot;
  }

  get client(): QqBotTransport {
    return this.#requireBot();
  }

  /** Live endpoint 名（Console/AdapterIndex 展示用，如 bot appid 别名）。 */
  get name(): string {
    return this.#options.config.id;
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    try {
      this.#bot = this.#createBot(this.#options.config);
      this.#bindBot(this.#bot);
      await this.#bot.start();
      this.#logger.info(
        `connected (websocket) | appid: ${this.#options.config.appid}`,
      );
    } catch (error) {
      await this.stop();
      this.#logger.error('Failed to connect QQ websocket:', error);
      const raw = error instanceof Error ? error.message : String(error);
      throw new Error(
        `QQ WebSocket 连接失败：请检查 appid/secret 是否配对、网关地址（gatewayUrl/accessTokenUrl）是否可达（原始错误：${raw}）`,
        { cause: error },
      );
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
    if (this.#bot) {
      try {
        this.#bot.removeAllListeners();
        await this.#bot.stop();
      } catch {
        /* ignore */
      }
      this.#bot = null;
    }
    this.#started = false;
    this.#logger.debug(formatCompact({ op: 'disconnect' }));
  }

  async send({ conversation, payload }: EndpointSendRequest): Promise<string> {
    const body = formatOutbound(payload);
    const kind = qqOutboundKind(conversation);
    const bot = this.#requireBot();
    let result: unknown;
    switch (kind) {
      case 'private':
        result = await bot.sendPrivateMessage(conversation.id, body);
        break;
      case 'group':
        result = await bot.sendGroupMessage(conversation.id, body);
        break;
      case 'channel':
        result = await bot.sendGuildMessage(conversation.id, body);
        break;
      case 'direct':
        if (!bot.sendDirectMessage) throw new Error('QQ direct message not supported by transport');
        result = await bot.sendDirectMessage(conversation.id, body);
        break;
    }
    const messageId = `${kind}-${conversation.id}:${resolveOutboundMessageId(result)}`;
    this.#logger.info(
      `send ${kind}:${conversation.id}`
      + ` | id: ${messageId}`
      + ` | ${truncatePreview(typeof body === 'string' ? body : String(body), 80)}`,
    );
    return messageId;
  }

  async recallMessage(messageId: string): Promise<void> {
    const { kind, channelId, qqMsgId } = parseCompoundMessageId(messageId);
    const bot = this.#requireBot();
    switch (kind) {
      case 'private':
        await bot.recallPrivateMessage?.(channelId, qqMsgId);
        break;
      case 'group':
        await bot.recallGroupMessage?.(channelId, qqMsgId);
        break;
      case 'channel':
        await bot.recallGuildMessage?.(channelId, qqMsgId);
        break;
      case 'direct':
        await bot.recallDirectMessage?.(channelId, qqMsgId);
        break;
    }
    this.#logger.debug(formatCompact({
      op: 'qq_recall',
      endpoint: this.#options.config.id,
      kind,
      messageId,
    }));
  }

  /** Test / internal: admit a message when open. */
  admit(msg: QqInboundMessage): void {
    if (!this.#open) return;
    const conversation = qqInboundConversation(String(this.#options.id), msg);
    const content = formatInboundContent(msg);
    this.#logger.info(
      `recv ${conversation.kind}:${conversation.id}`
      + (msg.authorId ? ` from ${msg.authorId}` : '')
      + (msg.mentioned ? ' (mentioned)' : '')
      + ` | ${truncatePreview(content, 80)}`,
    );
    void this.emit('message.receive', {
      conversation,
      message: { conversation, id: msg.id },
      content,
      ...(msg.segments?.length ? { segments: msg.segments } : {}),
      sender: {
        id: msg.authorId,
        name: senderDisplayName(msg) || undefined,
        ...(msg.authorRoles?.length ? { roles: msg.authorRoles } : {}),
      },
      endpointId: this.#options.config.id,
      ...(msg.mentioned ? { mentioned: true } : {}),
      metadata: Object.freeze({
        channelKind: msg.channelKind,
        userId: msg.authorId,
        guildId: msg.guildId,
        roles: msg.authorRoles,
      }),
    }).catch((err) => {
      this.#logger.warn(formatCompact({
        op: 'qq_gateway_receive_failed',
        target: `${conversation.kind}:${conversation.id}`,
        error: err instanceof Error ? err.message : String(err),
      }));
    });
  }

  #bindBot(bot: QqBotTransport): void {
    bindQqBotInboundEvents(bot, (raw) => {
      this.#emitPlatformEvent('message', raw);
      const msg = normalizeQqMessage(raw);
      if (msg) this.admit(msg);
    });
    bindQqBotSideEvents(bot, (eventName, raw) => {
      this.#emitPlatformEvent(eventName, raw);
      receiveQqSideEvent(
        (name, payload) => this.emit(name, payload),
        this.#options.config.id,
        bot as QqSideEventCaller,
        eventName,
        raw,
        this.#logger,
      );
    });
  }

  #emitPlatformEvent(name: string, event: unknown): void {
    void this.emitPlatform(name, event).catch((error) => {
      this.#logger.warn(formatCompact({
        op: 'qq_platform_event_failed',
        event: name,
        error: error instanceof Error ? error.message : String(error),
      }));
    });
  }

  #requireBot(): QqBotTransport {
    if (!this.#bot) throw new Error('QQ bot not connected');
    return this.#bot;
  }
}

export interface QqHttpEndpointOptions {
  readonly id: CapabilityId;
  readonly http: HttpHost;
  readonly config: ResolvedQqHttpConfig;
  readonly createBot?: CreateQqHttpBot;
}

/** Webhook / middleware inbound via httpHostToken POST (qq-official-bot Middleware receiver). */
export class QqHttpEndpoint extends Endpoint<QqHttpBotTransport> {
  readonly #logger!: ReturnType<typeof getAdapterLogger>;

  readonly #options: QqHttpEndpointOptions;
  readonly #createBot: CreateQqHttpBot;
  #bot: QqHttpBotTransport | null = null;
  #routeReleases: ReturnType<typeof registerQqWebhookRoutes> = [];
  #open = false;
  #started = false;
  readonly management: EndpointManagement = createQqEndpointManagement(() => this.#requireBot());
  readonly control: EndpointControl = createRecallEndpointControl((id) => this.recallMessage(id));

  constructor(options: QqHttpEndpointOptions) {
    super();
    this.#logger = getAdapterLogger('qq', options.config.id);
    this.#options = options;
    this.#createBot = options.createBot ?? defaultCreateHttpBot;
  }

  get client(): QqHttpBotTransport {
    return this.#requireBot();
  }

  /** Live endpoint 名（Console/AdapterIndex 展示用）。 */
  get name(): string {
    return this.#options.config.id;
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    try {
      this.#setupRoutes();
      this.#bot = this.#createBot(this.#options.config);
      this.#bindBot(this.#bot);
      await this.#bot.start();
      this.#logger.info(
        `connected (${this.#options.config.mode}) | path: ${this.#options.config.webhookPath}`,
      );
    } catch (error) {
      await this.stop();
      this.#logger.error('Failed to connect QQ HTTP receiver:', error);
      throw error;
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
    for (const release of this.#routeReleases.splice(0)) release();
    if (this.#bot) {
      try {
        this.#bot.removeAllListeners();
        await this.#bot.stop();
      } catch {
        /* ignore */
      }
      this.#bot = null;
    }
    this.#started = false;
    this.#logger.debug(formatCompact({ op: 'disconnect' }));
  }

  async send({ conversation, payload }: EndpointSendRequest): Promise<string> {
    const body = formatOutbound(payload);
    const kind = qqOutboundKind(conversation);
    const bot = this.#requireBot();
    let result: unknown;
    switch (kind) {
      case 'private':
        result = await bot.sendPrivateMessage(conversation.id, body);
        break;
      case 'group':
        result = await bot.sendGroupMessage(conversation.id, body);
        break;
      case 'channel':
        result = await bot.sendGuildMessage(conversation.id, body);
        break;
      case 'direct':
        if (!bot.sendDirectMessage) throw new Error('QQ direct message not supported by transport');
        result = await bot.sendDirectMessage(conversation.id, body);
        break;
    }
    const messageId = `${kind}-${conversation.id}:${resolveOutboundMessageId(result)}`;
    this.#logger.info(
      `send ${kind}:${conversation.id}`
      + ` | id: ${messageId}`
      + ` | ${truncatePreview(typeof body === 'string' ? body : String(body), 80)}`,
    );
    return messageId;
  }

  async recallMessage(messageId: string): Promise<void> {
    const { kind, channelId, qqMsgId } = parseCompoundMessageId(messageId);
    const bot = this.#requireBot();
    switch (kind) {
      case 'private':
        await bot.recallPrivateMessage?.(channelId, qqMsgId);
        break;
      case 'group':
        await bot.recallGroupMessage?.(channelId, qqMsgId);
        break;
      case 'channel':
        await bot.recallGuildMessage?.(channelId, qqMsgId);
        break;
      case 'direct':
        await bot.recallDirectMessage?.(channelId, qqMsgId);
        break;
    }
    this.#logger.debug(formatCompact({
      op: 'qq_recall',
      endpoint: this.#options.config.id,
      kind,
      messageId,
    }));
  }

  admit(msg: QqInboundMessage): void {
    if (!this.#open) return;
    const conversation = qqInboundConversation(String(this.#options.id), msg);
    const content = formatInboundContent(msg);
    this.#logger.info(
      `recv ${conversation.kind}:${conversation.id}`
      + (msg.authorId ? ` from ${msg.authorId}` : '')
      + (msg.mentioned ? ' (mentioned)' : '')
      + ` | ${truncatePreview(content, 80)}`,
    );
    void this.emit('message.receive', {
      conversation,
      message: { conversation, id: msg.id },
      content,
      ...(msg.segments?.length ? { segments: msg.segments } : {}),
      sender: {
        id: msg.authorId,
        name: senderDisplayName(msg) || undefined,
        ...(msg.authorRoles?.length ? { roles: msg.authorRoles } : {}),
      },
      endpointId: this.#options.config.id,
      ...(msg.mentioned ? { mentioned: true } : {}),
      metadata: Object.freeze({
        channelKind: msg.channelKind,
        userId: msg.authorId,
        guildId: msg.guildId,
        roles: msg.authorRoles,
      }),
    }).catch((err) => {
      this.#logger.warn(formatCompact({
        op: 'qq_gateway_receive_failed',
        target: `${conversation.kind}:${conversation.id}`,
        error: err instanceof Error ? err.message : String(err),
      }));
    });
  }

  #setupRoutes(): void {
    this.#routeReleases.push(...registerQqWebhookRoutes(this.#options.http, {
      config: this.#options.config,
      getBot: () => this.#bot,
    }));
  }

  #bindBot(bot: QqBotTransport): void {
    bindQqBotInboundEvents(bot, (raw) => {
      this.#emitPlatformEvent('message', raw);
      const msg = normalizeQqMessage(raw);
      if (msg) this.admit(msg);
    });
    bindQqBotSideEvents(bot, (eventName, raw) => {
      this.#emitPlatformEvent(eventName, raw);
      receiveQqSideEvent(
        (name, payload) => this.emit(name, payload),
        this.#options.config.id,
        bot as QqSideEventCaller,
        eventName,
        raw,
        this.#logger,
      );
    });
  }

  #emitPlatformEvent(name: string, event: unknown): void {
    void this.emitPlatform(name, event).catch((error) => {
      this.#logger.warn(formatCompact({
        op: 'qq_platform_event_failed',
        event: name,
        error: error instanceof Error ? error.message : String(error),
      }));
    });
  }

  #requireBot(): QqHttpBotTransport {
    if (!this.#bot) throw new Error('QQ bot not connected');
    return this.#bot;
  }
}

function createQqEndpointManagement(
  requireClient: () => Pick<QqBotTransport, 'getGuilds' | 'getChannels'>,
): EndpointManagement {
  return Object.freeze<EndpointManagement>({
    async listChannels(): Promise<readonly EndpointChannel[]> {
      const channels: EndpointChannel[] = [];
      const client = requireClient();
      const guilds = await client.getGuilds();
      for (const guildValue of Array.isArray(guilds) ? guilds : []) {
        const guild = asRecord(guildValue);
        const guildId = String(guild.id ?? guild.guild_id ?? guildValue ?? '');
        if (!guildId) continue;
        const guildName = String(guild.name ?? guild.guild_name ?? guildId);
        const rows = await client.getChannels(guildId);
        for (const channelValue of Array.isArray(rows) ? rows : []) {
          const channel = asRecord(channelValue);
          const id = String(channel.id ?? channel.channel_id ?? channelValue ?? '');
          if (!id) continue;
          channels.push({
            id,
            name: String(channel.name ?? channel.channel_name ?? id),
            parent: { type: 'guild', id: guildId, name: guildName },
          });
        }
      }
      return channels;
    },
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};
}
