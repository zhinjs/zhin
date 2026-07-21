/**
 * QQ endpoints — lifecycle, outbound, admit, agent tool surface.
 */
import type { EndpointInstance } from '@zhin.js/adapter';
import type { MessageGateway } from '@zhin.js/core/runtime';
import type { HttpHost } from '@zhin.js/host-http';
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { CapabilityId } from '@zhin.js/plugin-runtime';
import { registerQqAgentEndpoint } from './qq-agent-deps.js';
import {
  formatInboundContent,
  formatInboundTarget,
  formatOutboundText,
  parseSendTarget,
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

const logger = getLogger('qq');

export type { CreateQqBot, QqBotTransport } from './ws.js';
export type { CreateQqHttpBot, QqHttpBotTransport } from './webhook.js';

export interface QqEndpointOptions {
  readonly id: CapabilityId;
  readonly gateway: MessageGateway;
  readonly config: ResolvedQqWebsocketConfig;
  readonly createBot?: CreateQqBot;
}

export class QqWebsocketEndpoint implements EndpointInstance {
  readonly #options: QqEndpointOptions;
  readonly #createBot: CreateQqBot;
  #bot: QqBotTransport | null = null;
  #open = false;
  #started = false;
  #unregisterAgent?: () => void;

  constructor(options: QqEndpointOptions) {
    this.#options = options;
    this.#createBot = options.createBot ?? defaultCreateBot;
  }

  /** Live endpoint 名（Console/AdapterIndex 展示用，如 bot appid 别名）。 */
  get name(): string {
    return this.#options.config.name;
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    try {
      this.#unregisterAgent = registerQqAgentEndpoint(this.#options.config.name, this);
      this.#bot = this.#createBot(this.#options.config);
      this.#bindBot(this.#bot);
      await this.#bot.start();
      logger.info(formatCompact({
        op: 'connect',
        endpoint: this.#options.config.name,
        mode: 'websocket',
        appid: this.#options.config.appid,
      }));
    } catch (error) {
      await this.stop();
      logger.error('Failed to connect QQ websocket:', error);
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
    this.#unregisterAgent?.();
    this.#unregisterAgent = undefined;
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
    logger.debug(formatCompact({ op: 'disconnect', endpoint: this.#options.config.name }));
  }

  async send({ target, payload }: { readonly target: string; readonly payload: unknown }): Promise<string> {
    const body = formatOutboundText(payload);
    const parsed = parseSendTarget(target);
    const bot = this.#requireBot();
    let result: unknown;
    switch (parsed.kind) {
      case 'private':
        result = await bot.sendPrivateMessage(parsed.id, body);
        break;
      case 'group':
        result = await bot.sendGroupMessage(parsed.id, body);
        break;
      case 'channel':
        result = await bot.sendGuildMessage(parsed.id, body);
        break;
      case 'direct':
        if (!bot.sendDirectMessage) throw new Error('QQ direct message not supported by transport');
        result = await bot.sendDirectMessage(parsed.id, body);
        break;
      default:
        throw new Error(`unsupported QQ target kind: ${String((parsed as ParsedSendTarget).kind)}`);
    }
    const messageId = `${parsed.kind}-${parsed.id}:${resolveOutboundMessageId(result)}`;
    logger.debug(formatCompact({
      op: 'qq_send',
      endpoint: this.#options.config.name,
      target,
      messageId,
    }));
    return messageId;
  }

  /** Test / internal: admit a message when open. */
  admit(msg: QqInboundMessage): void {
    if (!this.#open) return;
    const target = formatInboundTarget(msg);
    void this.#options.gateway.receive({
      adapter: this.#options.id,
      target,
      content: formatInboundContent(msg),
      sender: senderDisplayName(msg),
      id: msg.id,
      metadata: Object.freeze({
        endpoint: this.#options.config.name,
        channelKind: msg.channelKind,
        userId: msg.authorId,
        guildId: msg.guildId,
        roles: msg.authorRoles,
        // AT 事件本身即 @ 机器人；新 Runtime 纯文本 content 需经 metadata 传递
        ...(msg.mentioned ? { mentioned: true } : {}),
      }),
    }).catch((err) => {
      logger.warn(formatCompact({
        op: 'qq_gateway_receive_failed',
        target,
        error: err instanceof Error ? err.message : String(err),
      }));
    });
  }

  getGuilds() {
    return this.#requireBot().getGuilds();
  }

  getChannels(guildId: string) {
    return this.#requireBot().getChannels(guildId);
  }

  getChannelInfo(channelId: string) {
    return this.#requireBot().getChannelInfo(channelId);
  }

  getGuildMember(guildId: string, userId: string) {
    return this.#requireBot().getGuildMember(guildId, userId);
  }

  getGuildRoles(guildId: string) {
    return this.#requireBot().getGuildRoles(guildId);
  }

  createGuildRole(guildId: string, name: string, color?: number) {
    return this.#requireBot().createGuildRole(guildId, name, color);
  }

  addMemberRole(guildId: string, channelId: string, userId: string, roleId: string) {
    return this.#requireBot().addMemberRole(guildId, channelId, userId, roleId);
  }

  removeMemberRole(guildId: string, channelId: string, userId: string, roleId: string) {
    return this.#requireBot().removeMemberRole(guildId, channelId, userId, roleId);
  }

  #bindBot(bot: QqBotTransport): void {
    bindQqBotInboundEvents(bot, (raw) => {
      const msg = normalizeQqMessage(raw);
      if (msg) this.admit(msg);
    });
  }

  #requireBot(): QqBotTransport {
    if (!this.#bot) throw new Error('QQ bot not connected');
    return this.#bot;
  }
}

type ParsedSendTarget = ReturnType<typeof parseSendTarget>;

export interface QqHttpEndpointOptions {
  readonly id: CapabilityId;
  readonly gateway: MessageGateway;
  readonly http: HttpHost;
  readonly config: ResolvedQqHttpConfig;
  readonly createBot?: CreateQqHttpBot;
}

/** Webhook / middleware inbound via httpHostToken POST (qq-official-bot Middleware receiver). */
export class QqHttpEndpoint implements EndpointInstance {
  readonly #options: QqHttpEndpointOptions;
  readonly #createBot: CreateQqHttpBot;
  #bot: QqHttpBotTransport | null = null;
  #routeReleases: ReturnType<typeof registerQqWebhookRoutes> = [];
  #open = false;
  #started = false;
  #unregisterAgent?: () => void;

  constructor(options: QqHttpEndpointOptions) {
    this.#options = options;
    this.#createBot = options.createBot ?? defaultCreateHttpBot;
  }

  /** Live endpoint 名（Console/AdapterIndex 展示用）。 */
  get name(): string {
    return this.#options.config.name;
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    try {
      this.#unregisterAgent = registerQqAgentEndpoint(
        this.#options.config.name,
        this as unknown as QqWebsocketEndpoint,
      );
      this.#setupRoutes();
      this.#bot = this.#createBot(this.#options.config);
      this.#bindBot(this.#bot);
      await this.#bot.start();
      logger.info(formatCompact({
        op: 'connect',
        endpoint: this.#options.config.name,
        mode: this.#options.config.mode,
        path: this.#options.config.webhookPath,
      }));
    } catch (error) {
      await this.stop();
      logger.error('Failed to connect QQ HTTP receiver:', error);
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
    this.#unregisterAgent?.();
    this.#unregisterAgent = undefined;
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
    logger.debug(formatCompact({ op: 'disconnect', endpoint: this.#options.config.name }));
  }

  async send({ target, payload }: { readonly target: string; readonly payload: unknown }): Promise<string> {
    const body = formatOutboundText(payload);
    const parsed = parseSendTarget(target);
    const bot = this.#requireBot();
    let result: unknown;
    switch (parsed.kind) {
      case 'private':
        result = await bot.sendPrivateMessage(parsed.id, body);
        break;
      case 'group':
        result = await bot.sendGroupMessage(parsed.id, body);
        break;
      case 'channel':
        result = await bot.sendGuildMessage(parsed.id, body);
        break;
      case 'direct':
        if (!bot.sendDirectMessage) throw new Error('QQ direct message not supported by transport');
        result = await bot.sendDirectMessage(parsed.id, body);
        break;
      default:
        throw new Error(`unsupported QQ target kind: ${String((parsed as ParsedSendTarget).kind)}`);
    }
    return `${parsed.kind}-${parsed.id}:${resolveOutboundMessageId(result)}`;
  }

  admit(msg: QqInboundMessage): void {
    if (!this.#open) return;
    const target = formatInboundTarget(msg);
    void this.#options.gateway.receive({
      adapter: this.#options.id,
      target,
      content: formatInboundContent(msg),
      sender: senderDisplayName(msg),
      id: msg.id,
      metadata: Object.freeze({
        endpoint: this.#options.config.name,
        channelKind: msg.channelKind,
        userId: msg.authorId,
        guildId: msg.guildId,
        roles: msg.authorRoles,
        // AT 事件本身即 @ 机器人；新 Runtime 纯文本 content 需经 metadata 传递
        ...(msg.mentioned ? { mentioned: true } : {}),
      }),
    }).catch((err) => {
      logger.warn(formatCompact({
        op: 'qq_gateway_receive_failed',
        target,
        error: err instanceof Error ? err.message : String(err),
      }));
    });
  }

  getGuilds() {
    return this.#requireBot().getGuilds();
  }

  getChannels(guildId: string) {
    return this.#requireBot().getChannels(guildId);
  }

  getChannelInfo(channelId: string) {
    return this.#requireBot().getChannelInfo(channelId);
  }

  getGuildMember(guildId: string, userId: string) {
    return this.#requireBot().getGuildMember(guildId, userId);
  }

  getGuildRoles(guildId: string) {
    return this.#requireBot().getGuildRoles(guildId);
  }

  createGuildRole(guildId: string, name: string, color?: number) {
    return this.#requireBot().createGuildRole(guildId, name, color);
  }

  addMemberRole(guildId: string, channelId: string, userId: string, roleId: string) {
    return this.#requireBot().addMemberRole(guildId, channelId, userId, roleId);
  }

  removeMemberRole(guildId: string, channelId: string, userId: string, roleId: string) {
    return this.#requireBot().removeMemberRole(guildId, channelId, userId, roleId);
  }

  #setupRoutes(): void {
    this.#routeReleases.push(...registerQqWebhookRoutes(this.#options.http, {
      config: this.#options.config,
      getBot: () => this.#bot,
    }));
  }

  #bindBot(bot: QqBotTransport): void {
    bindQqBotInboundEvents(bot, (raw) => {
      const msg = normalizeQqMessage(raw);
      if (msg) this.admit(msg);
    });
  }

  #requireBot(): QqBotTransport {
    if (!this.#bot) throw new Error('QQ bot not connected');
    return this.#bot;
  }
}
