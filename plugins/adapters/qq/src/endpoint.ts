import { installQqUploadDiagnostics } from './upload-diagnostics.js';
import { qqDeliveryFailure } from './delivery-error.js';
import { normalizeQqInteraction } from './interaction.js';
import { awaitQqStartup } from './start-deadline.js';
import { EndpointDeliveryError } from '@zhin.js/im-contract';
/**
 * QQ endpoints — lifecycle, outbound, admit, agent tool surface.
 */
import {
  Endpoint, createEndpointLifecycle, type EndpointLifecycle,
  createRecallEndpointControl,
  type EndpointControl,
  type EndpointChannel,
  type EndpointManagement,
  type EndpointSendRequest,
  type EndpointTransportState,
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

export type { CreateQqBot, QqBotTransport, QqOfficialApi } from './ws.js';
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
  readonly #seenInteractions = new Map<string, number>();
  readonly #lifecycle: EndpointLifecycle;
  #cleanup?: () => Promise<void>;
  readonly management: EndpointManagement = createQqEndpointManagement(() => this.#requireBot());
  readonly control: EndpointControl = createRecallEndpointControl((id) => this.recallMessage(id));

  constructor(options: QqEndpointOptions) {
    super();
    this.#logger = getAdapterLogger('qq', options.config.id);
    this.#lifecycle = createEndpointLifecycle({ name: options.config.id });
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

  get transportState(): EndpointTransportState {
    if (this.#lifecycle.state !== 'open') return this.#lifecycle.state;
    return this.#bot?.transportState ?? this.#lifecycle.state;
  }

  async start(): Promise<void> {
    await this.#lifecycle.start(async (handle) => {
      const bot = this.#createBot(this.#options.config);
      this.#bot = bot;
      const releaseUploadDiagnostics = installQqUploadDiagnostics(bot.api, metadata => this.#logger.debug(formatCompact(metadata)));
      let cancelled = false;
      const startupAbort = new AbortController();
      let stopping: Promise<void> | undefined;
      const stopBot = async () => {
        try { bot.removeAllListeners(); } catch { /* continue SDK cleanup */ }
        try { await bot.stop(); } catch { /* best-effort SDK cleanup */ }
      };
      const cleanup = () => {
        cancelled = true;
        releaseUploadDiagnostics();
        startupAbort.abort();
        if (this.#bot === bot) this.#bot = null;
        return stopping ??= stopBot();
      };
      this.#cleanup = cleanup;
      handle.onForceClose(() => { void cleanup(); });
      try {
        bot.on('transport.close', () => { if (cancelled || this.#bot !== bot) return; void cleanup(); handle.notifyClosed(); });
        this.#bindBot(bot);
        await awaitQqStartup(bot.start().then(async () => {
          if (cancelled) await stopBot();
        }, async (error) => {
          if (cancelled) await stopBot();
          throw error;
        }), startupAbort.signal);
        if (cancelled) {
          // SDK startup may create resources after stop; close this exact old client again.
          await stopping;
          return;
        }
        this.#logger.info(`connected (websocket) | appid: ${this.#options.config.appid}`);
      } catch (error) {
        const wasCancelled = cancelled;
        await cleanup();
        if (wasCancelled) return;
        const raw = error instanceof Error ? error.message : String(error);
        throw new Error(
          `QQ WebSocket 连接失败：请检查 appid/secret 是否配对、网关地址（gatewayUrl/accessTokenUrl）是否可达（原始错误：${raw}）`,
          { cause: error },
        );
      }
    });
  }

  open(): void {
    this.#open = true;
  }

  close(): void {
    this.#open = false;
  }

  async stop(): Promise<void> {
    this.#open = false;
    const cleanup = this.#cleanup;
    this.#cleanup = undefined;
    await this.#lifecycle.stop();
    await cleanup?.();
    this.#logger.debug(formatCompact({ op: 'disconnect' }));
  }

  async send({ conversation, payload }: EndpointSendRequest): Promise<string> {
    const body = formatOutbound(payload);
    const kind = qqOutboundKind(conversation);
    const bot = this.#requireBot();
    let result: unknown;
    try {
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
    } catch (error) {
      const { failure, diagnostic } = qqDeliveryFailure(error);
      this.#logger.warn(formatCompact(diagnostic));
      throw failure;
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
    await recallQqMessage(bot, kind, channelId, qqMsgId);
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

  /** Native click only; C2C/group have no platform source message ID. */
  admitInteraction(raw: unknown): boolean {
    if (!this.#open) return false;
    const action = normalizeQqInteraction(raw);
    if (!action) return false;
    const now = Date.now();
    for (const [id, time] of this.#seenInteractions) if (now - time > 300_000) this.#seenInteractions.delete(id);
    if (this.#seenInteractions.has(action.message.id)) return true;
    this.#seenInteractions.set(action.message.id, now);
    if (this.#seenInteractions.size > 10_000) this.#seenInteractions.delete(this.#seenInteractions.keys().next().value!);
    // ACK owns only platform loading state, never implies business acceptance.
    void action.ack().then(ok => { if (ok === false) this.#logger.warn('qq_interaction_ack_failed'); }, () => this.#logger.warn('qq_interaction_ack_failed'));
    const conversation = qqInboundConversation(String(this.#options.id), action.message);
    void this.emit('message.receive', {
      conversation, message: { conversation, id: action.message.id }, content: '',
      segments: action.message.segments, sender: { id: action.message.authorId }, endpointId: this.#options.config.id,
      metadata: Object.freeze({ eventType: 'INTERACTION_CREATE', sourceMessageIdAvailable: action.sourceMessageId !== undefined,
        ...(action.sourceMessageId ? { sourceMessageId: action.sourceMessageId } : {}),
        callbackAssociation: action.sourceMessageId ? 'source-message' : 'payload-conversation-actor' }),
    }).catch(() => this.#logger.warn('qq_interaction_receive_failed'));
    return true;
  }

  #bindBot(bot: QqBotTransport): void {
    bindQqBotInboundEvents(bot, (raw) => {
      if (this.#bot !== bot) return;
      this.#emitPlatformEvent('message', raw);
      const msg = normalizeQqMessage(raw);
      if (msg) this.admit(msg);
    });
    bindQqBotSideEvents(bot, (eventName, raw) => {
      if (this.#bot !== bot) return;
      this.#emitPlatformEvent(eventName, raw);
      if (this.admitInteraction(raw)) return;
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
    if (!this.#bot) throw new EndpointDeliveryError('endpoint_disconnected', 'QQ bot not connected', 'not_sent');
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
  #open = false;
  readonly #seenInteractions = new Map<string, number>();
  readonly #lifecycle: EndpointLifecycle;
  #cleanup?: () => Promise<void>;
  readonly management: EndpointManagement = createQqEndpointManagement(() => this.#requireBot());
  readonly control: EndpointControl = createRecallEndpointControl((id) => this.recallMessage(id));

  constructor(options: QqHttpEndpointOptions) {
    super();
    this.#logger = getAdapterLogger('qq', options.config.id);
    this.#lifecycle = createEndpointLifecycle({ name: options.config.id, reconnect: false });
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

  get transportState(): EndpointTransportState {
    return this.#lifecycle.state;
  }

  async start(): Promise<void> {
    await this.#lifecycle.start(async (handle) => {
      const bot = this.#createBot(this.#options.config);
      this.#bot = bot;
      const releaseUploadDiagnostics = installQqUploadDiagnostics(bot.api, metadata => this.#logger.debug(formatCompact(metadata)));
      let cancelled = false;
      const startupAbort = new AbortController();
      let stopping: Promise<void> | undefined;
      const routes: Array<() => void> = [];
      const stopBot = async () => {
        try { bot.removeAllListeners(); } catch { /* continue SDK cleanup */ }
        try { await bot.stop(); } catch { /* best-effort SDK cleanup */ }
      };
      const cleanup = () => {
        cancelled = true;
        releaseUploadDiagnostics();
        startupAbort.abort();
        if (this.#bot === bot) this.#bot = null;
        for (const release of routes.splice(0)) release();
        return stopping ??= stopBot();
      };
      this.#cleanup = cleanup;
      handle.onForceClose(() => { void cleanup(); });
      try {
        this.#bindBot(bot);
        routes.push(...registerQqWebhookRoutes(this.#options.http, {
          config: this.#options.config,
          getBot: () => cancelled ? null : bot,
        }));
        await awaitQqStartup(bot.start().then(async () => {
          if (cancelled) await stopBot();
        }, async (error) => {
          if (cancelled) await stopBot();
          throw error;
        }), startupAbort.signal);
        if (cancelled) {
          // SDK startup may create resources after stop; close this exact old client again.
          await stopping;
          return;
        }
        this.#logger.info(`connected (${this.#options.config.mode}) | path: ${this.#options.config.webhookPath}`);
      } catch (error) {
        const wasCancelled = cancelled;
        await cleanup();
        if (wasCancelled) return;
        throw error;
      }
    });
  }

  open(): void {
    this.#open = true;
  }

  close(): void {
    this.#open = false;
  }

  async stop(): Promise<void> {
    this.#open = false;
    const cleanup = this.#cleanup;
    this.#cleanup = undefined;
    await this.#lifecycle.stop();
    await cleanup?.();
    this.#logger.debug(formatCompact({ op: 'disconnect' }));
  }

  async send({ conversation, payload }: EndpointSendRequest): Promise<string> {
    const body = formatOutbound(payload);
    const kind = qqOutboundKind(conversation);
    const bot = this.#requireBot();
    let result: unknown;
    try {
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
    } catch (error) {
      const { failure, diagnostic } = qqDeliveryFailure(error);
      this.#logger.warn(formatCompact(diagnostic));
      throw failure;
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
    await recallQqMessage(bot, kind, channelId, qqMsgId);
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

  /** Native click only; C2C/group have no platform source message ID. */
  admitInteraction(raw: unknown): boolean {
    if (!this.#open) return false;
    const action = normalizeQqInteraction(raw);
    if (!action) return false;
    const now = Date.now();
    for (const [id, time] of this.#seenInteractions) if (now - time > 300_000) this.#seenInteractions.delete(id);
    if (this.#seenInteractions.has(action.message.id)) return true;
    this.#seenInteractions.set(action.message.id, now);
    if (this.#seenInteractions.size > 10_000) this.#seenInteractions.delete(this.#seenInteractions.keys().next().value!);
    // ACK owns only platform loading state, never implies business acceptance.
    void action.ack().then(ok => { if (ok === false) this.#logger.warn('qq_interaction_ack_failed'); }, () => this.#logger.warn('qq_interaction_ack_failed'));
    const conversation = qqInboundConversation(String(this.#options.id), action.message);
    void this.emit('message.receive', {
      conversation, message: { conversation, id: action.message.id }, content: '',
      segments: action.message.segments, sender: { id: action.message.authorId }, endpointId: this.#options.config.id,
      metadata: Object.freeze({ eventType: 'INTERACTION_CREATE', sourceMessageIdAvailable: action.sourceMessageId !== undefined,
        ...(action.sourceMessageId ? { sourceMessageId: action.sourceMessageId } : {}),
        callbackAssociation: action.sourceMessageId ? 'source-message' : 'payload-conversation-actor' }),
    }).catch(() => this.#logger.warn('qq_interaction_receive_failed'));
    return true;
  }

  #bindBot(bot: QqBotTransport): void {
    bindQqBotInboundEvents(bot, (raw) => {
      if (this.#bot !== bot) return;
      this.#emitPlatformEvent('message', raw);
      const msg = normalizeQqMessage(raw);
      if (msg) this.admit(msg);
    });
    bindQqBotSideEvents(bot, (eventName, raw) => {
      if (this.#bot !== bot) return;
      this.#emitPlatformEvent(eventName, raw);
      if (this.admitInteraction(raw)) return;
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
    if (!this.#bot) throw new EndpointDeliveryError('endpoint_disconnected', 'QQ bot not connected', 'not_sent');
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

async function recallQqMessage(bot: QqBotTransport, kind: ReturnType<typeof qqOutboundKind>, channelId: string, messageId: string): Promise<void> {
  const recall = { private: bot.recallPrivateMessage, group: bot.recallGroupMessage,
    channel: bot.recallGuildMessage, direct: bot.recallDirectMessage }[kind];
  if (!recall) throw new EndpointDeliveryError('recall_unsupported', 'QQ transport does not support recall for this conversation', 'not_sent');
  if (!messageId) throw new EndpointDeliveryError('invalid_message_id', 'QQ recall requires a nonempty message ID', 'not_sent');
  await recall.call(bot, channelId, messageId);
}
