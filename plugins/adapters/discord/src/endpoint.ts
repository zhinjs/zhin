import { createDiscordRestApiAgent } from './rest-api-proxy.js';
import { createDiscordSelfProfile, createDiscordRestSelfProfile } from './self-profile.js';
import { DiscordRestRequestError } from './rest-request-error.js';
import { isDiscordChannelObfuscated } from './channel-visibility.js';
/**
 * DiscordEndpoint — lifecycle, outbound, admit, gateway / interactions modes, agent tool surface.
 */
import { Client, ChannelType } from 'discord.js';
import {
  createEndpointSpecification,
  endpointSpec,
  type Endpoint,
  type EndpointSpecification,
  createEndpointLifecycle,
  type EndpointChannel,
  type EndpointContentPort,
  type EndpointContentResolveContext,
  type EndpointControl,
  type EndpointRecallRequest,
  type EndpointReactionRequest,
  type EndpointGroup,
  type EndpointManagement,
  type EndpointSendRequest,
  type EndpointTransportState,
  type EndpointManagementRequest,
  createEndpointOperation,
  type EndpointGroupRequest,
} from 'zhin.js/adapter';
import type { HttpHost, HttpRouteRegistration } from '@zhin.js/host-http';
import {
  type ConversationRef,
  type ConversationReference,
  type ConversationResolution,
  type PlatformStanding,
  type SelfStandingRequest,
} from '@zhin.js/im-contract';
import { formatCompact, getAdapterLogger } from '@zhin.js/logger';
import type { CapabilityId } from 'zhin.js';
import {
  connectDiscordGatewayClient,
  discordClientOptions,
  DEFAULT_INTENTS,
  toMessageCreateOptions,
  type DiscordClientTransport,
} from './gateway.js';
import {
  discordChannelOf,
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
import {
  discordGuildPermissionNamesFromChannelBitfield, discordPermissionNames, discordSenderStanding, discordStandingFromPermissions,
} from './sender-standing.js';

const DISCORD_API = 'https://discord.com/api/v10';
/** 出站 HTTP 调用统一 30s 超时。 */
const OUTBOUND_TIMEOUT_MS = 30_000;
export type {
  DiscordClientTransport,
} from './gateway.js';

export interface DiscordEndpointOptions {
  readonly id: CapabilityId;
  readonly config: ResolvedDiscordGatewayConfig;
  readonly restApiAgent?: ReturnType<typeof createDiscordRestApiAgent>;
  readonly fetch?: typeof globalThis.fetch;
}

export class DiscordGatewayEndpoint extends Client implements Endpoint {
  readonly [endpointSpec]: EndpointSpecification;
  readonly #logger!: ReturnType<typeof getAdapterLogger>;

  readonly #options: DiscordEndpointOptions;
  readonly #fetch: typeof globalThis.fetch;
  #connection?: AbortController;
  #sdkDisposal?: Promise<void>;
  #open = false;
  readonly #lifecycle = createEndpointLifecycle({ name: 'discord', reconnect: false });
  #cleanup?: () => Promise<void>;
  #retiring?: Promise<void>;
  readonly #management: EndpointManagement = createDiscordEndpointManagement(
    () => this.#requireClient(),
  );
  readonly #control: EndpointControl = Object.freeze<EndpointControl>({
    recall: request => this.#recallMessage(request),
    addReaction: request => this.#addReaction(request),
  });
  readonly #content: EndpointContentPort = Object.freeze({
    resolve: (reference: ConversationReference, context: EndpointContentResolveContext) =>
      resolveDiscordContent(this.#fetch, this.#options.config.token, reference, context),
  });

  constructor(options: DiscordEndpointOptions) {
    super(discordClientOptions(options.config.intents?.length ? options.config.intents : DEFAULT_INTENTS,
      options.config.gatewayFaultProxyUrl, options.restApiAgent ? { agent: options.restApiAgent } : {}));
    this.#logger = getAdapterLogger('discord', options.config.id);
    this.#options = options;
    this.#fetch = options.fetch ?? globalThis.fetch;
    const endpoint = this;
    this[endpointSpec] = createEndpointSpecification(this, {
      start: signal => this.#startFramework(signal), open: () => this.#openFramework(), close: () => this.#closeFramework(),
      stop: () => this.#stopFramework(), send: request => this.#sendFramework(request),
      get name() { return options.config.id; }, get transportState() { return endpoint.#transportState; },
      management: this.#management, control: this.#control, content: this.#content, profile: createDiscordSelfProfile(this),
    });
  }

  get #transportState(): EndpointTransportState | undefined {
    if (this.#lifecycle.state !== 'open') return this.#lifecycle.state;
    if (!this.#connection) return 'closed';
    return this.isReady() ? 'open' : 'reconnecting';
  }

  async #startFramework(executionSignal: AbortSignal): Promise<void> {
    await this.#retiring;
    await this.#lifecycle.start(async handle => {
    let cleanup: (() => Promise<void>) | undefined; let cancelled = false;
    try {
      const client = this;
      const abort = new AbortController(); let stopping: Promise<void> | undefined;
      this.#connection = abort;
      cleanup = () => {
        cancelled = true;
        abort.abort();
        if (this.#connection === abort) this.#connection = undefined;
        return stopping ??= this.#disposeSdk();
      };
      this.#cleanup = cleanup;
      handle.onForceClose(() => { void cleanup?.().catch(() => {}); });
      await connectDiscordGatewayClient(client, this.#options.config, {
        receive: action => this[endpointSpec].events.run(action),
        onPlatformEvent: (name, event) => {
          if (this.#connection !== abort) return;
          void this.#emitPlatformEvent(name, event);
        },
        onMessage: (msg) => { if (this.#connection === abort) return this.admit(msg); },
        onButton: (interaction) => { if (this.#connection === abort) return this.admitButton(interaction); },
        onGuildMemberAdd: (member) => {
          if (this.#connection !== abort) return;
          receiveDiscordGuildMemberSideEvent(
            (name, payload) => this[endpointSpec].events.emit(name, payload),
            this.#options.config.id,
            'member_increase',
            member,
            this.#logger,
          );
        },
        onGuildMemberRemove: (member) => {
          if (this.#connection !== abort) return;
          receiveDiscordGuildMemberSideEvent(
            (name, payload) => this[endpointSpec].events.emit(name, payload),
            this.#options.config.id,
            'member_decrease',
            member,
            this.#logger,
          );
        },
      }, AbortSignal.any([abort.signal, executionSignal]));
      if (abort.signal.aborted || this.#connection !== abort) return;
      if (this.user?.id) this[endpointSpec].reportSelfUserId(this.user.id);
      this.#logger.info(formatCompact({
        op: 'connect',
        endpoint: this.#options.config.id,
        mode: 'gateway',
        user: this.user?.tag,
      }));
    } catch (error) {
      const stopped = cancelled;
      try { await cleanup?.(); } catch { /* original connect failure wins */ }
      if (stopped) return;
      this.#logger.error('Failed to connect Discord gateway:', error);
      throw error;
    }
    });
  }

  #openFramework(): void {
    this.#open = true;
  }

  #closeFramework(): void {
    this.#open = false;
  }

  async #stopFramework(): Promise<void> {
    this.#open = false;
    const cleanup = this.#cleanup;
    this.#cleanup = undefined;
    this.#lifecycle.stop();
    const retiring = this.#retiring ?? Promise.resolve().then(() => cleanup ? cleanup() : this.#disposeSdk());
    this.#retiring = retiring;
    await retiring;
    if (this.#retiring === retiring) this.#retiring = undefined;
    this.#logger.debug(formatCompact({ op: 'disconnect' }));
  }

  async #sendFramework({ conversation, payload, signal }: EndpointSendRequest): Promise<string> {
    const body = formatOutboundBody(payload);
    const snowflake = await this.#sendBody({ channelId: discordChannelOf(conversation), body, signal });
    this.#logger.debug(formatCompact({
      op: 'discord_send',
      endpoint: this.#options.config.id,
      target: discordChannelOf(conversation),
      messageId: snowflake,
    }));
    return snowflake;
  }

  async #recallMessage({ message, signal }: EndpointRecallRequest): Promise<void> {
    if (!message.id) return;
    const operation = createEndpointOperation({ signal });
    const channel = await operation.prepare(() => this.#requireClient().channels.fetch(discordChannelOf(message.conversation)));
    if (!channel?.isTextBased() || !channel.messages) return;
    const msg = await operation.prepare(() => channel.messages.fetch(message.id));
    await operation.run(() => msg.delete());
  }

  /** Test / internal: admit a message when open. */
  admit(msg: DiscordInboundMessage): void {
    if (!this.#open) return;
    if (msg.authorBot) return;
    const conversation = discordInboundConversation(String(this.#options.id), msg);
    const platform = discordSenderStanding(msg);
    void this[endpointSpec].events.emit('message.receive', {
      conversation,
      event: msg.event,
      platformSentAt: msg.platformSentAt,
      message: { conversation, id: msg.id },
      content: formatInboundContent(msg),
      segments: formatInboundSegments(msg),
      sender: {
        id: msg.authorId,
        name: senderDisplayName(msg) || undefined,
        ...(platform ? { platform } : {}),
      },
      endpointId: this.#options.config.id,
      ...(msg.mentionedBot ? { mentioned: true } : {}),
      ...(msg.replyToId ? { replyTo: { id: msg.replyToId } } : {}),
      metadata: Object.freeze({
        channelKind: msg.channelKind,
        userId: msg.authorId,
        guildId: msg.guildId,
        permissions: msg.permissionTokens,
        role: platform?.standing,
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
    void this[endpointSpec].events.emit('message.receive', {
      event: interaction.event,
      platformSentAt: interaction.platformSentAt,
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

  async #addReaction({ message, emoji, hint, signal }: EndpointReactionRequest): Promise<string | null> {
    const channelId = hint?.channelId ?? discordChannelOf(message.conversation);
    if (!channelId || !message.id) return null;
    const operation = createEndpointOperation({ signal });
    const channel = await operation.prepare(() => this.#requireClient().channels.fetch(channelId));
    if (!channel?.isTextBased() || !channel.messages) throw new Error(`Channel ${channelId} 不是文本频道`);
    const native = await operation.prepare(() => channel.messages.fetch(message.id));
    await operation.run(() => native.react(emoji));
    return emoji;
  }

  async #emitPlatformEvent(name: string, event: unknown): Promise<void> {
    await this[endpointSpec].events.platform(name, event).catch((error) => {
      this.#logger.warn(formatCompact({
        op: 'discord_platform_event_failed',
        event: name,
        error: error instanceof Error ? error.message : String(error),
      }));
    });
  }

  async #sendBody({ channelId, body, signal }: DiscordCreateMessageRequest): Promise<string> {
    const operation = createEndpointOperation({ signal });
    let stage = 'fetch_channel';
    try {
      const channel = await operation.prepare(() => this.#requireClient().channels.fetch(channelId));
      if (!channel || !channel.isSendable()) {
        throw new Error(`Channel ${channelId} is not a text channel`);
      }
      stage = 'render';
      const options = await operation.prepare(() => toMessageCreateOptions(body));
      stage = 'send';
      const result = await operation.run(async () => channel.send(options));
      return result.id;
    } catch (error) {
      const details = error as { code?: unknown; status?: unknown };
      this.#logger.warn(formatCompact({ op: 'discord_send_failed', stage,
        code: typeof details?.code === 'number' ? details.code : 'unknown',
        status: typeof details?.status === 'number' ? details.status : undefined,
      }));
      throw error;
    }
  }

  #disposeSdk(): Promise<void> {
    this.#sdkDisposal ??= Promise.resolve().then(async () => {
      this.removeAllListeners();
      try { await super.destroy(); } finally { await this.#options.restApiAgent?.destroyProxy(); }
    });
    return this.#sdkDisposal;
  }

  #requireClient(): DiscordClientTransport {
    if (!this.#connection) throw new Error('Discord client not connected');
    return this;
  }
}

export interface DiscordInteractionsEndpointOptions {
  readonly id: CapabilityId;
  readonly http: HttpHost;
  readonly config: ResolvedDiscordInteractionsConfig;
  readonly fetch?: typeof globalThis.fetch;
}

/** One Discord REST request retains the caller lifetime through response-body consumption. */
export interface DiscordRestRequest {
  readonly method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  readonly path: string;
  readonly body?: unknown;
  readonly signal?: AbortSignal;
}
/** Protocol target and payload for a single message publication. */
export interface DiscordCreateMessageRequest {
  readonly channelId: string;
  readonly body: DiscordOutboundBody;
  readonly signal?: AbortSignal;
}
/** Protocol target for a single existing-message deletion. */
export interface DiscordDeleteMessageRequest {
  readonly channelId: string;
  readonly messageId: string;
  readonly signal?: AbortSignal;
}

/** Minimal Discord REST client used when Gateway is intentionally disabled. */
export class DiscordRestClient {
  constructor(readonly token: string, readonly fetch: typeof globalThis.fetch = globalThis.fetch) {}

  async request<T = unknown>({ method, path, body, signal }: DiscordRestRequest): Promise<T> {
    const deadline = AbortSignal.timeout(OUTBOUND_TIMEOUT_MS);
    const operationSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
    const operation = createEndpointOperation({ signal: operationSignal });
    const execute = async () => {
      const encodedBody = body === undefined ? undefined : JSON.stringify(body);
      let response: Response | undefined;
      let text: string | undefined;
      try {
        response = await this.fetch(`${DISCORD_API}${path}`, {
          method,
          headers: { Authorization: `Bot ${this.token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
          ...(encodedBody === undefined ? {} : { body: encodedBody }),
          signal: operationSignal,
        });
        text = await response.text();
        if (!response.ok) throw new DiscordRestRequestError({ status: response.status, body: text });
        return (text ? JSON.parse(text) : undefined) as T;
      } catch (cause) {
        if (cause instanceof DiscordRestRequestError) throw cause;
        throw new DiscordRestRequestError({ status: response?.status, body: text, cause });
      }
    };
    return operation.run(execute);
  }
  createMessage({ channelId, body, signal }: DiscordCreateMessageRequest): Promise<{ id?: string }> {
    return this.request({ method: 'POST', path: `/channels/${channelId}/messages`, body, signal });
  }
  deleteMessage({ channelId, messageId, signal }: DiscordDeleteMessageRequest): Promise<void> {
    return this.request({ method: 'DELETE', path: `/channels/${channelId}/messages/${messageId}`, signal });
  }
}

const APP_PERMISSIONS_TTL_MS = 10 * 60_000;
const APP_PERMISSIONS_MAX = 1_000;

export class DiscordInteractionsEndpoint extends DiscordRestClient implements Endpoint {
  readonly [endpointSpec]: EndpointSpecification;
  readonly #logger!: ReturnType<typeof getAdapterLogger>;

  readonly #options: DiscordInteractionsEndpointOptions;
  readonly #fetch: typeof globalThis.fetch;
  #routeReleases: HttpRouteRegistration[] = [];
  #open = false;
  #started = false;
  /** Latest interaction `app_permissions` per guild (guild-level names), for the Bot's own standing. */
  readonly #appPermissions = new Map<string, { readonly names: readonly string[]; readonly at: number }>();
  readonly #control: EndpointControl = Object.freeze<EndpointControl>({
    recall: request => this.#recallMessage(request),
  });
  readonly #content: EndpointContentPort = Object.freeze({
    resolve: (reference: ConversationReference, context: EndpointContentResolveContext) =>
      resolveDiscordContent(this.#fetch, this.#options.config.token, reference, context),
  });

  constructor(options: DiscordInteractionsEndpointOptions) {
    super(options.config.token, options.fetch ?? globalThis.fetch);
    this.#logger = getAdapterLogger('discord', options.config.id);
    this.#options = options;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this[endpointSpec] = createEndpointSpecification(this, {
      start: () => this.#startFramework(), open: () => this.#openFramework(), close: () => this.#closeFramework(),
      stop: () => this.#stopFramework(), send: request => this.#sendFramework(request), name: options.config.id,
      // Interactions mode has no gateway session to read the bot's guild member: its own standing
      // comes from the latest interaction's `app_permissions` in that guild (ADR 0056 §1), reduced
      // to guild-level names like senders; without a recent interaction it stays unknown.
      management: Object.freeze<EndpointManagement>({
        inspectSelfStanding: async ({ conversation }) => this.#selfStandingFromInteractions(conversation),
      }),
      control: this.#control, content: this.#content,
      profile: createDiscordRestSelfProfile(this, id => this[endpointSpec].reportSelfUserId(id)),
    });
  }

  get isOpen(): boolean {
    return this.#open;
  }

  get config(): ResolvedDiscordInteractionsConfig {
    return this.#options.config;
  }

  async #startFramework(): Promise<void> {
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

  #openFramework(): void {
    this.#open = true;
  }

  #closeFramework(): void {
    this.#open = false;
  }

  async #stopFramework(): Promise<void> {
    this.#open = false;
    for (const release of this.#routeReleases.splice(0)) release();
    this.#started = false;
    this.#logger.debug(formatCompact({ op: 'disconnect' }));
  }

  async #sendFramework({ conversation, payload, signal }: EndpointSendRequest): Promise<string> {
    const body = formatOutboundBody(payload);
    const data = await this.createMessage({ channelId: discordChannelOf(conversation), body, signal });
    return data.id ?? '';
  }

  async #recallMessage({ message, signal }: EndpointRecallRequest): Promise<void> {
    if (!message.id) return;
    await this.deleteMessage({ channelId: discordChannelOf(message.conversation), messageId: message.id, signal });
  }

  #selfStandingFromInteractions(conversation: Pick<ConversationRef, 'kind' | 'parent'>): PlatformStanding | undefined {
    const guildId = conversation.kind === 'channel' && conversation.parent?.kind === 'channel' ? conversation.parent.id : undefined;
    const entry = guildId ? this.#appPermissions.get(guildId) : undefined;
    if (!entry || Date.now() - entry.at > APP_PERMISSIONS_TTL_MS) return undefined;
    // The guild owner is not visible to an interaction; `administrator` still reads as `admin`.
    return { standing: discordStandingFromPermissions(entry.names), ...(entry.names.length ? { permissions: entry.names } : {}) };
  }

  #recordAppPermissions(msg: DiscordInboundMessage): void {
    const appPermissions = (msg.event as { app_permissions?: unknown } | undefined)?.app_permissions;
    if (!msg.guildId || appPermissions === undefined) return;
    this.#appPermissions.delete(msg.guildId);
    this.#appPermissions.set(msg.guildId, { names: discordGuildPermissionNamesFromChannelBitfield(appPermissions), at: Date.now() });
    while (this.#appPermissions.size > APP_PERMISSIONS_MAX) {
      const oldest = this.#appPermissions.keys().next().value;
      if (oldest === undefined) break;
      this.#appPermissions.delete(oldest);
    }
  }

  admit(msg: DiscordInboundMessage): void {
    if (!this.#open) return;
    this.#recordAppPermissions(msg);
    const conversation = discordInboundConversation(String(this.#options.id), msg);
    const platform = discordSenderStanding(msg);
    void this[endpointSpec].events.emit('message.receive', {
      conversation,
      event: msg.event,
      platformSentAt: msg.platformSentAt,
      message: { conversation, id: msg.id },
      content: formatInboundContent(msg),
      segments: formatInboundSegments(msg),
      sender: {
        id: msg.authorId,
        name: senderDisplayName(msg) || undefined,
        ...(platform ? { platform } : {}),
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

  /** Test / internal: admit a button interaction when open. */
  admitButton(interaction: DiscordButtonInbound): void {
    if (!this.#open) return;
    const conversation = discordInboundConversation(String(this.#options.id), interaction);
    void this[endpointSpec].events.emit('message.receive', {
      event: interaction.event,
      platformSentAt: interaction.platformSentAt,
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

  admitPlatform(event: Record<string, unknown>): void {
    if (!this.#open) return;
    const type = typeof event.type === 'number' ? `interaction.${event.type}` : 'interaction';
    void this[endpointSpec].events.platform(type, event).catch((error) => {
      this.#logger.warn(formatCompact({
        op: 'discord_platform_event_failed',
        event: type,
        error: error instanceof Error ? error.message : String(error),
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
      `${DISCORD_API}/channels/${discordChannelOf(reference.message.conversation)}/messages/${reference.message.id}`,
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
 * DiscordGatewayEndpoint 的 EndpointManagement 语义端口（参照 qq 的工厂模式）。
 * 数据源为 discord.js SDK 缓存：guilds.cache / guild.channels.cache / guild.members。
 * listChannels 会过滤带 CHANNEL_OBFUSCATED flag 的混淆频道（见 channel-visibility.ts）。
 */
export function createDiscordEndpointManagement(
  requireClient: () => DiscordClientTransport,
): EndpointManagement {
  return Object.freeze<EndpointManagement>({
    /**
     * ADR 0056 §1: the Bot's own guild member in the conversation's guild — guild owner → `owner`;
     * `administrator` / `moderate_members` → `admin`; roles and **guild-level** permission names
     * (`GuildMember.permissions`, as for senders) so `bot-permission:*` and `platform-permission:*`
     * read the same scope. Channel overwrites are left to the platform at execution time.
     */
    async inspectSelfStanding({ conversation, signal }: SelfStandingRequest): Promise<PlatformStanding | undefined> {
      if (conversation.kind === 'private') return undefined;
      const operation = createEndpointOperation({ signal });
      const client = requireClient();
      const channel = await operation.run(() => client.channels.fetch(conversation.threadId ?? conversation.id));
      if (!channel || !('guild' in channel) || !client.user) return undefined;
      const guild = channel.guild;
      const me = guild.members.me ?? await operation.run(() => guild.members.fetchMe());
      const permissions = me.permissions;
      const names = permissions ? discordPermissionNames(bit => permissions.has(bit)) : [];
      const roles = [...me.roles.cache.values()]
        .filter(role => role.id !== guild.id)
        .map(role => (role.name ? { id: String(role.id), name: String(role.name) } : { id: String(role.id) }));
      const standing = discordStandingFromPermissions(names, guild.ownerId === client.user.id);
      return { standing, ...(roles.length ? { roles } : {}), ...(names.length ? { permissions: names } : {}) };
    },
    async listGroups(request: EndpointManagementRequest = {}): Promise<readonly EndpointGroup[]> {
      return createEndpointOperation(request).run(() => {
        const groups: EndpointGroup[] = [];
        for (const guild of requireClient().guilds.cache.values()) {
          if (!guild?.id) continue;
          groups.push({
            group_id: String(guild.id),
            name: String(guild.name ?? guild.id),
          });
        }
        return groups;
      });
    },
    async listChannels(request: EndpointManagementRequest = {}): Promise<readonly EndpointChannel[]> {
      return createEndpointOperation(request).run(() => {
        const channels: EndpointChannel[] = [];
        for (const guild of requireClient().guilds.cache.values()) {
          if (!guild?.id) continue;
          const guildId = String(guild.id);
          const guildName = String(guild.name ?? guildId);
          for (const channel of guild.channels?.cache?.values() ?? []) {
            if (!channel?.id) continue;
            if (channel.type !== ChannelType.GuildText) continue;
            // 机器人无 VIEW_CHANNEL 的频道会被 Gateway 混淆下发（HTTP 列表已不返回），默认过滤以保持两条路径一致。
            if (isDiscordChannelObfuscated(channel)) continue;
            channels.push({
              id: String(channel.id),
              name: channel.name ? String(channel.name) : undefined,
              parent: { type: 'guild', id: guildId, name: guildName },
            });
          }
        }
        return channels;
      });
    },
    async listGroupMembers({ groupId, signal }: EndpointGroupRequest): Promise<readonly unknown[]> {
      const operation = createEndpointOperation({ signal });
      const guild = await operation.run(() => requireClient().guilds.fetch(groupId));
      const members = await operation.run(() => guild.members.fetch({ limit: 100 })) as Map<string, {
        id: string;
        user: { username: string };
        nickname: string | null;
        roles: { cache: { map(fn: (role: { id: string }) => string): string[] } };
        joinedAt?: Date | null;
      }>;
      return [...members.values()].map((member) => ({
        id: member.id,
        username: member.user.username,
        nickname: member.nickname,
        roles: member.roles.cache.map((role) => role.id),
        joined_at: member.joinedAt?.toISOString(),
      }));
    },
  });
}
