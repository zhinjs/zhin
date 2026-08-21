/**
 * DiscordEndpoint — lifecycle, outbound, admit, gateway / interactions modes, agent tool surface.
 */
import { ChannelType } from 'discord.js';
import type {
  EndpointChannel,
  EndpointContentPort,
  EndpointContentResolveContext,
  EndpointControl,
  EndpointGroup,
  EndpointInstance,
  EndpointManagement,
  EndpointSendRequest,
} from 'zhin.js/adapter';
import type { MessageGateway, SideEventGateway } from '@zhin.js/core/runtime';
import type { HttpHost, HttpRouteRegistration } from '@zhin.js/host-http';
import {
  type ConversationReference,
  type ConversationResolution,
  type MessageRef,
} from '@zhin.js/im-contract';
import { formatCompact, getAdapterLogger } from '@zhin.js/logger';
import type { CapabilityId } from 'zhin.js';
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
import { receiveDiscordGuildMemberSideEvent } from './side-event-dispatch.js';

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
  readonly sideEvents?: SideEventGateway;
  readonly config: ResolvedDiscordGatewayConfig;
  readonly createClient?: CreateDiscordClient;
  readonly fetch?: typeof globalThis.fetch;
}

export class DiscordGatewayEndpoint implements EndpointInstance {
  readonly #logger!: ReturnType<typeof getAdapterLogger>;

  readonly #options: DiscordEndpointOptions;
  readonly #createClient: CreateDiscordClient;
  readonly #fetch: typeof globalThis.fetch;
  #client: DiscordClientTransport | null = null;
  #open = false;
  #started = false;
  #unregisterAgent?: () => void;
  readonly management: EndpointManagement = createDiscordEndpointManagement({
    getClient: () => this.#requireClient(),
    getMembers: (guildId) => this.getMembers(guildId),
  });
  readonly control: EndpointControl = Object.freeze({
    recall: (message: MessageRef) => this.recallMessage(message),
    addReaction: async (
      message: MessageRef,
      emoji: string,
      hint?: { readonly sceneType?: string; readonly channelId?: string },
    ) => {
      const channelId = hint?.channelId ?? message.conversation.id;
      if (!channelId || !message.id) return null;
      await this.addReaction(channelId, message.id, emoji);
      return emoji;
    },
  });
  readonly content: EndpointContentPort = Object.freeze({
    resolve: (reference: ConversationReference, context: EndpointContentResolveContext) =>
      resolveDiscordContent(this.#fetch, this.#options.config.token, reference, context),
  });

  constructor(options: DiscordEndpointOptions) {
    this.#logger = getAdapterLogger('discord', options.config.id);
    this.#options = options;
    this.#createClient = options.createClient ?? defaultCreateClient;
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    try {
      this.#unregisterAgent = registerDiscordAgentEndpoint(this.#options.config.id, this);
      const intents = this.#options.config.intents?.length
        ? [...this.#options.config.intents]
        : DEFAULT_INTENTS;
      this.#client = this.#createClient(intents);
      await connectDiscordGatewayClient(this.#client, this.#options.config, {
        onMessage: (msg) => this.admit(msg),
        onButton: (interaction) => this.admitButton(interaction),
        onGuildMemberAdd: (member) => {
          receiveDiscordGuildMemberSideEvent(
            this.#options.sideEvents,
            this.#options.config.id,
            'member_increase',
            member,
            this.#logger,
          );
        },
        onGuildMemberRemove: (member) => {
          receiveDiscordGuildMemberSideEvent(
            this.#options.sideEvents,
            this.#options.config.id,
            'member_decrease',
            member,
            this.#logger,
          );
        },
      });
      this.#logger.info(formatCompact({
        op: 'connect',
        endpoint: this.#options.config.id,
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
    const snowflake = await this.#sendBody(conversation.id, body);
    this.#logger.debug(formatCompact({
      op: 'discord_send',
      endpoint: this.#options.config.id,
      target: conversation.id,
      messageId: snowflake,
    }));
    return snowflake;
  }

  async recallMessage(message: MessageRef): Promise<void> {
    if (!message.id) return;
    const channel = await this.#requireClient().channels.fetch(message.conversation.id);
    if (!channel?.isTextBased() || !channel.messages) return;
    const msg = await channel.messages.fetch(message.id);
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
      sender: {
        id: msg.authorId,
        name: senderDisplayName(msg) || undefined,
        ...(resolveSenderRole(msg) ? { roles: [resolveSenderRole(msg)!] } : {}),
      },
      endpointId: this.#options.config.id,
      ...(msg.mentionedBot ? { mentioned: true } : {}),
      metadata: Object.freeze({
        channelKind: msg.channelKind,
        userId: msg.authorId,
        guildId: msg.guildId,
        permissions: msg.permissionTokens,
        role: resolveSenderRole(msg),
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
      sender: { id: interaction.userId, name: interaction.userName },
      endpointId: this.#options.config.id,
      metadata: Object.freeze({
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
  readonly sideEvents?: SideEventGateway;
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
    recall: (message: MessageRef) => this.recallMessage(message),
  });
  readonly content: EndpointContentPort = Object.freeze({
    resolve: (reference: ConversationReference, context: EndpointContentResolveContext) =>
      resolveDiscordContent(this.#fetch, this.#options.config.token, reference, context),
  });

  constructor(options: DiscordInteractionsEndpointOptions) {
    this.#logger = getAdapterLogger('discord', options.config.id);
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
      endpoint: this.#options.config.id,
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
    return snowflake;
  }

  async recallMessage(message: MessageRef): Promise<void> {
    if (!message.id) return;
    const response = await this.#fetch(`${DISCORD_API}/channels/${message.conversation.id}/messages/${message.id}`, {
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
      sender: {
        id: msg.authorId,
        name: senderDisplayName(msg) || undefined,
        ...(resolveSenderRole(msg) ? { roles: [resolveSenderRole(msg)!] } : {}),
      },
      endpointId: this.#options.config.id,
      metadata: Object.freeze({
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

async function resolveDiscordContent(
  fetch: typeof globalThis.fetch,
  token: string,
  reference: ConversationReference,
  context: EndpointContentResolveContext,
): Promise<ConversationResolution> {
  if (reference.kind === 'forward') {
    return Object.freeze({ status: 'unsupported', code: 'discord_merged_forward_unavailable' });
  }
  if (reference.kind === 'media') {
    return reference.media.kind === 'file'
      ? Object.freeze({ status: 'unsupported', code: 'discord_opaque_media_unavailable' })
      : Object.freeze({ status: 'resolved', reference, value: reference.media });
  }
  try {
    context.signal.throwIfAborted();
    const response = await fetch(
      `${DISCORD_API}/channels/${reference.message.conversation.id}/messages/${reference.message.id}`,
      { headers: { Authorization: `Bot ${token}` }, signal: context.signal },
    );
    if (response.status === 404) return Object.freeze({ status: 'not_found', code: 'discord_message_not_found' });
    if (response.status === 403) return Object.freeze({ status: 'forbidden', code: 'discord_message_forbidden' });
    if (!response.ok) return Object.freeze({ status: 'failed', code: 'discord_message_fetch_failed' });
    const row = await response.json() as Record<string, unknown>;
    const author = row.author as Record<string, unknown> | undefined;
    const attachments = Array.isArray(row.attachments) ? row.attachments : [];
    const segments: import('@zhin.js/im-contract').Segment[] = [];
    if (typeof row.content === 'string' && row.content.trim()) segments.push({ type: 'text', data: { text: row.content } });
    for (const item of attachments.slice(0, context.maxEntries)) {
      const attachment = item as Record<string, unknown>;
      if (typeof attachment.url !== 'string') continue;
      const mime = typeof attachment.content_type === 'string' ? attachment.content_type : undefined;
      const type = mime?.startsWith('image/') ? 'image' : mime?.startsWith('audio/') ? 'audio' : mime?.startsWith('video/') ? 'video' : 'file';
      segments.push({ type, data: { media: { kind: 'url', value: attachment.url, ...(mime ? { mime_type: mime } : {}), ...(attachment.filename ? { file_name: String(attachment.filename) } : {}), ...(typeof attachment.size === 'number' ? { size: attachment.size } : {}) } } });
    }
    return Object.freeze({
      status: 'resolved',
      reference,
      value: Object.freeze({
        ref: reference.message,
        ...(author?.id ? { actor: Object.freeze({ id: String(author.id), ...(author.global_name || author.username ? { displayName: String(author.global_name ?? author.username) } : {}) }) } : {}),
        segments: Object.freeze(segments),
        timestamp: typeof row.timestamp === 'string' ? Date.parse(row.timestamp) : Date.now(),
      }),
    });
  } catch (error) {
    if (context.signal.aborted) return Object.freeze({ status: 'expired', code: 'turn_aborted' });
    return Object.freeze({ status: 'failed', code: 'discord_content_resolution_failed', message: error instanceof Error ? error.message : String(error) });
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
