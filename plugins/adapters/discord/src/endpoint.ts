/**
 * DiscordEndpoint — lifecycle, outbound, admit, gateway / interactions modes, agent tool surface.
 */
import { ChannelType } from 'discord.js';
import type { EndpointInstance } from '@zhin.js/adapter';
import type { MessageGateway } from '@zhin.js/core/runtime';
import type { HttpHost, HttpRouteRegistration } from '@zhin.js/host-http';
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { CapabilityId } from '@zhin.js/plugin-runtime';
import { registerDiscordAgentEndpoint } from './discord-agent-deps.js';
import {
  connectDiscordGatewayClient,
  defaultCreateClient,
  DEFAULT_INTENTS,
  resolveSenderRole,
  toMessageCreateOptions,
  type CreateDiscordClient,
  type DiscordClientTransport,
} from './gateway.js';
import {
  formatButtonContent,
  formatInboundContent,
  formatOutboundBody,
  senderDisplayName,
  type DiscordButtonInbound,
  type DiscordInboundMessage,
  type DiscordOutboundBody,
  type ResolvedDiscordGatewayConfig,
  type ResolvedDiscordInteractionsConfig,
} from './protocol.js';
import { registerDiscordInteractionRoutes } from './webhook.js';

const DISCORD_API = 'https://discord.com/api/v10';
const logger = getLogger('discord');

export type {
  CreateDiscordClient,
  DiscordClientTransport,
} from './gateway.js';

export interface DiscordEndpointOptions {
  readonly id: CapabilityId;
  readonly gateway: MessageGateway;
  readonly config: ResolvedDiscordGatewayConfig;
  readonly createClient?: CreateDiscordClient;
}

export class DiscordGatewayEndpoint implements EndpointInstance {
  readonly #options: DiscordEndpointOptions;
  readonly #createClient: CreateDiscordClient;
  #client: DiscordClientTransport | null = null;
  #open = false;
  #started = false;
  #unregisterAgent?: () => void;
  readonly #messageChannelMap = new Map<string, string>();

  constructor(options: DiscordEndpointOptions) {
    this.#options = options;
    this.#createClient = options.createClient ?? defaultCreateClient;
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    try {
      this.#unregisterAgent = registerDiscordAgentEndpoint(this.#options.config.name, this);
      const intents = this.#options.config.intents?.length
        ? [...this.#options.config.intents]
        : DEFAULT_INTENTS;
      this.#client = this.#createClient(intents);
      await connectDiscordGatewayClient(this.#client, this.#options.config, {
        onMessage: (msg) => this.admit(msg),
        onButton: (interaction) => this.admitButton(interaction),
      });
      logger.info(formatCompact({
        op: 'connect',
        endpoint: this.#options.config.name,
        mode: 'gateway',
        user: this.#client.user?.tag,
      }));
    } catch (error) {
      await this.stop();
      logger.error('Failed to connect Discord gateway:', error);
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
    if (this.#client) {
      try {
        this.#client.removeAllListeners();
        await this.#client.destroy();
      } catch {
        /* ignore */
      }
      this.#client = null;
    }
    this.#started = false;
    logger.debug(formatCompact({ op: 'disconnect', endpoint: this.#options.config.name }));
  }

  async send({ target, payload }: { readonly target: string; readonly payload: unknown }): Promise<string> {
    const body = formatOutboundBody(payload);
    const messageId = await this.#sendBody(target, body);
    this.#messageChannelMap.set(messageId, target);
    logger.debug(formatCompact({
      op: 'discord_send',
      endpoint: this.#options.config.name,
      target,
      messageId,
    }));
    return messageId;
  }

  /** Test / internal: admit a message when open. */
  admit(msg: DiscordInboundMessage): void {
    if (!this.#open) return;
    if (msg.authorBot) return;
    this.#messageChannelMap.set(msg.id, msg.channelId);
    void this.#options.gateway.receive({
      adapter: this.#options.id,
      target: msg.channelId,
      content: formatInboundContent(msg),
      sender: senderDisplayName(msg),
      id: msg.id,
      metadata: Object.freeze({
        endpoint: this.#options.config.name,
        channelKind: msg.channelKind,
        userId: msg.authorId,
        guildId: msg.guildId,
        permissions: msg.permissionTokens,
        role: resolveSenderRole(msg),
        ...(msg.mentionedBot ? { mentioned: true } : {}),
      }),
    }).catch((err) => {
      logger.warn(formatCompact({
        op: 'discord_gateway_receive_failed',
        target: msg.channelId,
        error: err instanceof Error ? err.message : String(err),
      }));
    });
  }

  /** Test / internal: admit a button interaction when open. */
  admitButton(interaction: DiscordButtonInbound): void {
    if (!this.#open) return;
    void this.#options.gateway.receive({
      adapter: this.#options.id,
      target: interaction.channelId,
      content: formatButtonContent(interaction),
      sender: interaction.userName,
      id: interaction.id,
      metadata: Object.freeze({
        endpoint: this.#options.config.name,
        eventType: 'button',
        payload: interaction.customId,
        sourceMessageId: interaction.sourceMessageId,
      }),
    }).catch((err) => {
      logger.warn(formatCompact({
        op: 'discord_gateway_receive_failed',
        target: interaction.channelId,
        error: err instanceof Error ? err.message : String(err),
      }));
    });
  }

  // ── Agent tool surface ──────────────────────────────────────────────

  async addRole(guildId: string, userId: string, roleId: string): Promise<boolean> {
    const member = await this.#fetchMember(guildId, userId) as { roles: { add(id: string): Promise<unknown> } };
    await member.roles.add(roleId);
    return true;
  }

  async removeRole(guildId: string, userId: string, roleId: string): Promise<boolean> {
    const member = await this.#fetchMember(guildId, userId) as { roles: { remove(id: string): Promise<unknown> } };
    await member.roles.remove(roleId);
    return true;
  }

  async getRoles(guildId: string): Promise<unknown[]> {
    const guild = await this.#requireClient().guilds.fetch(guildId);
    await guild.roles.fetch();
    const cache = guild.roles.cache as Map<string, {
      id: string;
      name: string;
      hexColor: string;
      position: number;
      permissions: { bitfield: bigint };
    }>;
    return [...cache.values()].map((role) => ({
      id: role.id,
      name: role.name,
      color: role.hexColor,
      position: role.position,
      permissions: role.permissions.bitfield.toString(),
    }));
  }

  async createThread(
    channelId: string,
    name: string,
    messageId?: string,
    autoArchiveDuration?: number,
  ): Promise<{ id: string }> {
    const channel = await this.#requireClient().channels.fetch(channelId);
    if (!channel || !('threads' in channel) || !channel.threads) {
      throw new Error(`Channel ${channelId} 不支持创建帖子`);
    }
    const options: Record<string, unknown> = {
      name,
      autoArchiveDuration: autoArchiveDuration || 1440,
    };
    if (messageId) options.startMessage = messageId;
    return channel.threads.create(options);
  }

  async addReaction(channelId: string, messageId: string, emoji: string): Promise<void> {
    const channel = await this.#requireClient().channels.fetch(channelId);
    if (!channel?.isTextBased() || !channel.messages) {
      throw new Error(`Channel ${channelId} 不是文本频道`);
    }
    const message = await channel.messages.fetch(messageId);
    await message.react(emoji);
  }

  async sendEmbed(
    channelId: string,
    embedData: Record<string, unknown>,
  ): Promise<{ id: string }> {
    const body: DiscordOutboundBody = { embeds: [embedData] };
    const id = await this.#sendBody(channelId, body);
    return { id };
  }

  async createForumPost(
    channelId: string,
    name: string,
    content: string,
    tags?: string[],
  ): Promise<{ id: string }> {
    const channel = await this.#requireClient().channels.fetch(channelId);
    if (!channel || channel.type !== ChannelType.GuildForum || !channel.threads) {
      throw new Error(`Channel ${channelId} 不是论坛频道`);
    }
    const options: Record<string, unknown> = {
      name,
      message: { content },
    };
    if (tags?.length && channel.availableTags?.length) {
      const tagIds = channel.availableTags
        .filter((t) => tags.includes(t.name))
        .map((t) => t.id);
      if (tagIds.length) options.appliedTags = tagIds;
    }
    return channel.threads.create(options);
  }

  async kickMember(guildId: string, userId: string, reason?: string): Promise<boolean> {
    const member = await this.#fetchMember(guildId, userId) as { kick(reason?: string): Promise<unknown> };
    await member.kick(reason);
    return true;
  }

  async banMember(guildId: string, userId: string, reason?: string): Promise<boolean> {
    const guild = await this.#requireClient().guilds.fetch(guildId);
    await guild.members.ban(userId, { reason });
    return true;
  }

  async unbanMember(guildId: string, userId: string, reason?: string): Promise<boolean> {
    const guild = await this.#requireClient().guilds.fetch(guildId);
    await guild.members.unban(userId, reason);
    return true;
  }

  async timeoutMember(
    guildId: string,
    userId: string,
    duration = 600,
    reason?: string,
  ): Promise<boolean> {
    const member = await this.#fetchMember(guildId, userId) as {
      timeout(ms: number | null, reason?: string): Promise<unknown>;
    };
    await member.timeout(duration === 0 ? null : duration * 1000, reason);
    return true;
  }

  async setNickname(guildId: string, userId: string, nickname: string): Promise<boolean> {
    const member = await this.#fetchMember(guildId, userId) as {
      setNickname(nickname: string): Promise<unknown>;
    };
    await member.setNickname(nickname);
    return true;
  }

  async getMembers(guildId: string, limit = 100): Promise<unknown[]> {
    const guild = await this.#requireClient().guilds.fetch(guildId);
    const members = await guild.members.fetch({ limit }) as Map<string, {
      id: string;
      user: { username: string };
      nickname: string | null;
      roles: { cache: { map(fn: (r: { id: string }) => string): string[] } };
      joinedAt?: Date | null;
    }>;
    return [...members.values()].map((member) => ({
      id: member.id,
      username: member.user.username,
      nickname: member.nickname,
      roles: member.roles.cache.map((r) => r.id),
      joined_at: member.joinedAt?.toISOString(),
    }));
  }

  async getGuildInfo(guildId: string): Promise<unknown> {
    const guild = await this.#requireClient().guilds.fetch(guildId);
    return {
      id: guild.id,
      name: guild.name,
      icon: guild.iconURL?.(),
      owner_id: guild.ownerId,
      member_count: guild.memberCount,
      created_at: guild.createdAt?.toISOString(),
    };
  }

  async #sendBody(channelId: string, body: DiscordOutboundBody): Promise<string> {
    const channel = await this.#requireClient().channels.fetch(channelId);
    if (!channel || !channel.isTextBased() || !channel.send) {
      throw new Error(`Channel ${channelId} is not a text channel`);
    }
    const options = await toMessageCreateOptions(body);
    const result = await channel.send(options);
    return result.id;
  }

  async #fetchMember(guildId: string, userId: string): Promise<unknown> {
    const guild = await this.#requireClient().guilds.fetch(guildId);
    return guild.members.fetch(userId);
  }

  #requireClient(): DiscordClientTransport {
    if (!this.#client) throw new Error('Discord client not connected');
    return this.#client;
  }
}

export interface DiscordInteractionsEndpointOptions {
  readonly id: CapabilityId;
  readonly gateway: MessageGateway;
  readonly http: HttpHost;
  readonly config: ResolvedDiscordInteractionsConfig;
  readonly fetch?: typeof globalThis.fetch;
}

export class DiscordInteractionsEndpoint implements EndpointInstance {
  readonly #options: DiscordInteractionsEndpointOptions;
  readonly #fetch: typeof globalThis.fetch;
  #routeReleases: HttpRouteRegistration[] = [];
  #open = false;
  #started = false;

  constructor(options: DiscordInteractionsEndpointOptions) {
    this.#options = options;
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  get isOpen(): boolean {
    return this.#open;
  }

  get config(): ResolvedDiscordInteractionsConfig {
    return this.#options.config;
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    this.#routeReleases.push(...registerDiscordInteractionRoutes(this.#options.http, this));
    logger.info(formatCompact({
      op: 'connect',
      endpoint: this.#options.config.name,
      mode: 'interactions',
      path: this.#options.config.interactionsPath,
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
    logger.debug(formatCompact({ op: 'disconnect', endpoint: this.#options.config.name }));
  }

  async send({ target, payload }: { readonly target: string; readonly payload: unknown }): Promise<string> {
    const body = formatOutboundBody(payload);
    const response = await this.#fetch(`${DISCORD_API}/channels/${target}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${this.#options.config.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Discord send failed (${response.status}): ${text.slice(0, 200)}`);
    }
    const data = JSON.parse(text) as { id?: string };
    return data.id ?? '';
  }

  admit(msg: DiscordInboundMessage): void {
    if (!this.#open) return;
    void this.#options.gateway.receive({
      adapter: this.#options.id,
      target: msg.channelId,
      content: formatInboundContent(msg),
      sender: senderDisplayName(msg),
      id: msg.id,
      metadata: Object.freeze({
        endpoint: this.#options.config.name,
        channelKind: msg.channelKind,
        userId: msg.authorId,
        guildId: msg.guildId,
        eventType: 'application_command',
      }),
    }).catch((err) => {
      logger.warn(formatCompact({
        op: 'discord_gateway_receive_failed',
        target: msg.channelId,
        error: err instanceof Error ? err.message : String(err),
      }));
    });
  }
}
