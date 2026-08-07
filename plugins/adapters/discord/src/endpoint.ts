/**
 * DiscordEndpoint — lifecycle, outbound, admit, gateway / interactions modes, agent tool surface.
 */
import { ChannelType } from 'discord.js';
import type {
  EndpointChannel,
  EndpointControl,
  EndpointGroup,
  EndpointInstance,
  EndpointManagement,
  EndpointSendRequest,
} from '@zhin.js/adapter';
import type { MessageGateway } from '@zhin.js/core/runtime';
import type { HttpHost, HttpRouteRegistration } from '@zhin.js/host-http';
import {
  formatLegacyConversationRef,
  formatLegacyMessageReference,
  nativeConversationId,
  parseLegacyMessageReference,
} from '@zhin.js/im-contract';
import { formatCompact, getAdapterLogger } from '@zhin.js/logger';
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
  discordInboundConversation,
  formatButtonContent,
  formatButtonSegments,
  formatInboundContent,
  formatInboundSegments,
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
/** 出站 HTTP 调用统一 30s 超时。 */
const OUTBOUND_TIMEOUT_MS = 30_000;
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
  readonly #logger!: ReturnType<typeof getAdapterLogger>;

  readonly #options: DiscordEndpointOptions;
  readonly #createClient: CreateDiscordClient;
  #client: DiscordClientTransport | null = null;
  #open = false;
  #started = false;
  #unregisterAgent?: () => void;
  readonly management: EndpointManagement = createDiscordEndpointManagement({
    getClient: () => this.#requireClient(),
    getMembers: (guildId) => this.getMembers(guildId),
  });
  readonly control: EndpointControl = Object.freeze({
    recall: (messageId: string) => this.recallMessage(messageId),
    addReaction: async (
      messageId: string,
      emoji: string,
      hint?: { readonly sceneType?: string; readonly channelId?: string },
    ) => {
      const reference = parseLegacyMessageReference(messageId);
      const channelId = hint?.channelId
        ?? (reference ? nativeConversationId(reference.target) : undefined);
      const nativeMessageId = reference?.messageId ?? messageId;
      if (!channelId || !nativeMessageId) return null;
      await this.addReaction(channelId, nativeMessageId, emoji);
      return emoji;
    },
  });

  constructor(options: DiscordEndpointOptions) {
    this.#logger = getAdapterLogger('discord', options.config.name);
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
      this.#logger.info(formatCompact({
        op: 'connect',
        endpoint: this.#options.config.name,
        mode: 'gateway',
        user: this.#client.user?.tag,
      }));
    } catch (error) {
      await this.stop();
      this.#logger.error('Failed to connect Discord gateway:', error);
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
    this.#logger.debug(formatCompact({ op: 'disconnect' }));
  }

  async send({ conversation, payload }: EndpointSendRequest): Promise<string> {
    const body = formatOutboundBody(payload);
    // recall 链路仍是本端点编码的 legacy 引用，在边界内部从 conversation 派生 target
    const target = formatLegacyConversationRef(conversation);
    const snowflake = await this.#sendBody(conversation.id, body);
    const messageId = formatLegacyMessageReference({ target, messageId: snowflake });
    this.#logger.debug(formatCompact({
      op: 'discord_send',
      endpoint: this.#options.config.name,
      target,
      messageId,
    }));
    return messageId;
  }

  async recallMessage(messageId: string): Promise<void> {
    if (!messageId) return;
    const reference = parseLegacyMessageReference(messageId);
    if (!reference) return;
    const channelId = nativeConversationId(reference.target);
    const snowflake = reference.messageId;
    const channel = await this.#requireClient().channels.fetch(channelId);
    if (!channel?.isTextBased() || !channel.messages) return;
    const msg = await channel.messages.fetch(snowflake);
    await msg.delete();
  }

  /** Test / internal: admit a message when open. */
  admit(msg: DiscordInboundMessage): void {
    if (!this.#open) return;
    if (msg.authorBot) return;
    const conversation = discordInboundConversation(String(this.#options.id), msg);
    void this.#options.gateway.receive({
      conversation,
      message: { conversation, id: msg.id },
      content: formatInboundContent(msg),
      segments: formatInboundSegments(msg),
      sender: senderDisplayName(msg),
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
      this.#logger.warn(formatCompact({
        op: 'discord_gateway_receive_failed',
        target: `${conversation.kind}:${conversation.id}`,
        error: err instanceof Error ? err.message : String(err),
      }));
    });
  }

  /** Test / internal: admit a button interaction when open. */
  admitButton(interaction: DiscordButtonInbound): void {
    if (!this.#open) return;
    const conversation = discordInboundConversation(String(this.#options.id), interaction);
    void this.#options.gateway.receive({
      conversation,
      message: { conversation, id: interaction.id },
      content: formatButtonContent(interaction),
      segments: formatButtonSegments(interaction),
      sender: interaction.userName,
      metadata: Object.freeze({
        endpoint: this.#options.config.name,
        eventType: 'button',
        payload: interaction.customId,
        sourceMessageId: interaction.sourceMessageId,
      }),
    }).catch((err) => {
      this.#logger.warn(formatCompact({
        op: 'discord_gateway_receive_failed',
        target: `${conversation.kind}:${conversation.id}`,
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
  readonly #logger!: ReturnType<typeof getAdapterLogger>;

  readonly #options: DiscordInteractionsEndpointOptions;
  readonly #fetch: typeof globalThis.fetch;
  #routeReleases: HttpRouteRegistration[] = [];
  #open = false;
  #started = false;
  readonly control: EndpointControl = Object.freeze({
    recall: (messageId: string) => this.recallMessage(messageId),
  });

  constructor(options: DiscordInteractionsEndpointOptions) {
    this.#logger = getAdapterLogger('discord', options.config.name);
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
    this.#logger.info(formatCompact({
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
    this.#logger.debug(formatCompact({ op: 'disconnect' }));
  }

  async send({ conversation, payload }: EndpointSendRequest): Promise<string> {
    const body = formatOutboundBody(payload);
    const channelId = conversation.id;
    const response = await this.#fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${this.#options.config.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(OUTBOUND_TIMEOUT_MS),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Discord send failed (${response.status}): ${text.slice(0, 200)}`);
    }
    const data = JSON.parse(text) as { id?: string };
    const snowflake = data.id ?? '';
    // recall 链路仍是本端点编码的 legacy 引用，在边界内部从 conversation 派生 target
    return snowflake
      ? formatLegacyMessageReference({
        target: formatLegacyConversationRef(conversation),
        messageId: snowflake,
      })
      : '';
  }

  async recallMessage(messageId: string): Promise<void> {
    if (!messageId) return;
    const reference = parseLegacyMessageReference(messageId);
    if (!reference) return;
    const channelId = nativeConversationId(reference.target);
    const snowflake = reference.messageId;
    const response = await this.#fetch(`${DISCORD_API}/channels/${channelId}/messages/${snowflake}`, {
      method: 'DELETE',
      headers: { Authorization: `Bot ${this.#options.config.token}` },
      signal: AbortSignal.timeout(OUTBOUND_TIMEOUT_MS),
    });
    if (!response.ok && response.status !== 404) {
      const text = await response.text();
      throw new Error(`Discord recall failed (${response.status}): ${text.slice(0, 200)}`);
    }
  }

  admit(msg: DiscordInboundMessage): void {
    if (!this.#open) return;
    const conversation = discordInboundConversation(String(this.#options.id), msg);
    void this.#options.gateway.receive({
      conversation,
      message: { conversation, id: msg.id },
      content: formatInboundContent(msg),
      segments: formatInboundSegments(msg),
      sender: senderDisplayName(msg),
      metadata: Object.freeze({
        endpoint: this.#options.config.name,
        channelKind: msg.channelKind,
        userId: msg.authorId,
        guildId: msg.guildId,
        eventType: 'application_command',
      }),
    }).catch((err) => {
      this.#logger.warn(formatCompact({
        op: 'discord_gateway_receive_failed',
        target: `${conversation.kind}:${conversation.id}`,
        error: err instanceof Error ? err.message : String(err),
      }));
    });
  }
}

/**
 * Discord snowflake 是 64 位整数的字符串形式，超出 Number.MAX_SAFE_INTEGER，
 * Number() 转换会丢精度。Console 社交面只把 group_id 当 JSON 值透传、
 * 并以字符串回传给 listGroupMembers，因此这里保留原始字符串（仅按契约
 * 类型声明强转），是全链路最不丢信息的方案。
 */
function toGroupId(id: string): number {
  return id as unknown as number;
}

/**
 * DiscordGatewayEndpoint 的 EndpointManagement 语义端口（参照 qq 的工厂模式）。
 * 数据源为 discord.js SDK 缓存：guilds.cache / guild.channels.cache / guild.members。
 */
export function createDiscordEndpointManagement(endpoint: {
  getClient(): DiscordClientTransport;
  getMembers(guildId: string): Promise<unknown[]>;
}): EndpointManagement {
  return Object.freeze<EndpointManagement>({
    async listGroups(): Promise<readonly EndpointGroup[]> {
      const groups: EndpointGroup[] = [];
      for (const guild of endpoint.getClient().guilds.cache.values()) {
        if (!guild?.id) continue;
        groups.push({
          group_id: toGroupId(String(guild.id)),
          name: String(guild.name ?? guild.id),
        });
      }
      return groups;
    },
    async listChannels(): Promise<readonly EndpointChannel[]> {
      const channels: EndpointChannel[] = [];
      for (const guild of endpoint.getClient().guilds.cache.values()) {
        if (!guild?.id) continue;
        const guildId = String(guild.id);
        const guildName = String(guild.name ?? guildId);
        for (const channel of guild.channels?.cache?.values() ?? []) {
          if (!channel?.id) continue;
          if (channel.type !== ChannelType.GuildText) continue;
          channels.push({
            id: String(channel.id),
            name: channel.name ? String(channel.name) : undefined,
            parent: { type: 'guild', id: guildId, name: guildName },
          });
        }
      }
      return channels;
    },
    async listGroupMembers(groupId: string): Promise<readonly unknown[]> {
      return endpoint.getMembers(groupId);
    },
  });
}
