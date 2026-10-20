import { EndpointDeliveryError, type ConversationRef } from '@zhin.js/im-contract';
/**
 * KookEndpoint — lifecycle, outbound, admit, OpenAPI helpers for agent tools.
 */
import { Client } from 'kook-client';
import {
  Endpoint,
  type EndpointControl,
  type EndpointChannel,
  type EndpointGroup,
  type EndpointManagement,
  type EndpointSendRequest,
  type EndpointTransportState,
} from 'zhin.js/adapter';
import type { HttpHost, HttpRouteRegistration } from '@zhin.js/host-http';
import { formatCompact, getAdapterLogger } from '@zhin.js/logger';
import type { CapabilityId } from 'zhin.js';
import {
  formatInboundContent,

  isKookBotMentioned,
  kookInboundConversation,
  normalizeKookWebhookEvent,
  normalizeKookButtonEvent,
  senderDisplayName,
  type KookInboundMessage,
  type KookWebhookEventData,
  type ResolvedKookWebhookConfig,
  type ResolvedKookWebsocketConfig,
} from './protocol.js';
import { registerKookWebhookRoutes } from './webhook.js';
import {
  defaultCreateClient,
  defaultCreateWebhookClient,
  normalizeKookMessage,
  type CreateKookClient,
  type KookClientTransport,
} from './ws.js';
import { recallKookMessage, sendKookOutbound } from './outbound.js';
import { receiveKookSideEvent } from './side-event-dispatch.js';

export interface KookEndpointOptions {
  readonly id: CapabilityId;
  readonly config: ResolvedKookWebsocketConfig;
  readonly createClient?: CreateKookClient;
}

export class KookWebsocketEndpoint extends Endpoint<KookClientTransport> {
  #sentConversations = new Map<string, ConversationRef>();
  readonly #logger!: ReturnType<typeof getAdapterLogger>;

  readonly #options: KookEndpointOptions;
  readonly #createClient: CreateKookClient;
  #client: KookClientTransport | null = null;
  #open = false;
  #started = false;
  readonly management: EndpointManagement = createKookEndpointManagement(() => this.#requireClient());
  readonly control: EndpointControl = Object.freeze<EndpointControl>({
    recall: (message) => recallKookMessage(this.#requireClient(), message),
  });

  constructor(options: KookEndpointOptions) {
    super();
    this.#logger = getAdapterLogger('kook', options.config.id);
    this.#options = options;
    this.#createClient = options.createClient ?? (defaultCreateClient as CreateKookClient);
  }

  get client(): KookClientTransport {
    return this.#requireClient();
  }

  get transportState(): EndpointTransportState | undefined {
    if (!this.#started) return 'stopped';
    return this.#client?.getTransportState?.();
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    try {
      this.#client = this.#createClient(this.#options.config);
      this.#bindClient(this.#client);
      await this.#client.connect();
      this.#logger.info(formatCompact({
        op: 'connect',
        endpoint: this.#options.config.id,
        mode: 'websocket',
        self_id: this.#client.self_id != null ? String(this.#client.self_id) : undefined,
      }));
    } catch (error) {
      await this.stop();
      this.#logger.error('Failed to connect KOOK websocket:', error);
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
    this.#sentConversations.clear();
    if (this.#client) {
      try {
        this.#client.removeAllListeners();
        await this.#client.disconnect();
      } catch {
        /* ignore */
      }
      this.#client = null;
    }
    this.#started = false;
    this.#logger.debug(formatCompact({ op: 'disconnect' }));
  }

  async send({ conversation, payload }: EndpointSendRequest): Promise<string> {
    const messageId = await sendKookOutbound(this.#requireClient(), { conversation, payload });
    rememberKookConversation(this.#sentConversations, messageId, conversation);
    this.#logger.debug(formatCompact({
      op: 'kook_send',
      endpoint: this.#options.config.id,
      target: `${conversation.kind}:${conversation.id}`,
      messageId,
    }));
    return messageId;
  }

  /** Test / internal: admit a normalized message when open. */
  admit(msg: KookInboundMessage): void {
    if (!this.#open) return;
    if (msg.authorBot) return;
    const conversation = kookInboundConversation(String(this.#options.id), msg);
    const selfId = this.#client?.self_id != null ? String(this.#client.self_id) : undefined;
    void this.emit('message.receive', {
      conversation,
      message: { conversation, id: msg.id },
      content: formatInboundContent(msg),
      sender: {
        id: msg.authorId,
        name: senderDisplayName(msg) || undefined,
        ...(msg.authorRoles?.length ? { roles: msg.authorRoles.map(String) } : {}),
      },
      endpointId: this.#options.config.id,
      ...(isKookBotMentioned(msg, selfId) ? { mentioned: true } : {}),
      metadata: Object.freeze({
        channelKind: msg.channelKind,
        userId: msg.authorId,
        guildId: msg.guildId,
        roles: msg.authorRoles,
      }),
    }).catch((err) => {
      this.#logger.warn(formatCompact({
        op: 'kook_gateway_receive_failed',
        target: `${conversation.kind}:${conversation.id}`,
        error: err instanceof Error ? err.message : String(err),
      }));
    });
  }

  async recallMessage(messageId: string, conversation?: ConversationRef): Promise<void> {
    if (!conversation) throw new EndpointDeliveryError('unsupported_operation', 'KOOK recall requires conversation routing', 'rejected');
    await recallKookMessage(this.#requireClient(), { id: messageId, conversation });
  }

  #bindClient(client: KookClientTransport): void {
    client.on('message', (raw) => {
      this.#emitPlatformEvent('message', raw);
      const msg = normalizeKookMessage(raw);
      if (msg) this.admit(msg);
    });
    const receiver = (client as { receiver?: { on(event: string, listener: (...args: unknown[]) => void): void } }).receiver;
    receiver?.on('event', (raw) => {
      if (this.#client !== client || !this.#open) return;
      this.#emitPlatformEvent('event', raw);
      if (normalizeKookButtonEvent(raw)) {
        void this.admitButton(raw).catch(error => this.#logger.warn(formatCompact({ op: 'kook_button_failed', error: error instanceof Error ? error.message : 'dispatch failed' })));
        return;
      }
      receiveKookSideEvent((name, payload) => this.emit(name, payload), this.#options.config.id, raw, this.#logger);
    });
  }

  async admitButton(raw: unknown): Promise<void> {
    if (!this.#open) throw new Error('KOOK endpoint is closed');
    const event = normalizeKookButtonEvent(raw);
    if (!event) throw new Error('Invalid KOOK button event');
    await this.emitAccepted('message.receive', kookButtonIngress(String(this.#options.id), this.#options.config.id, event, this.#sentConversations.get(event.sourceMessageId)));
  }

  #emitPlatformEvent(name: string, event: unknown): void {
    void this.emitPlatform(name, event).catch((error) => {
      this.#logger.warn(formatCompact({
        op: 'kook_platform_event_failed',
        event: name,
        error: error instanceof Error ? error.message : String(error),
      }));
    });
  }

  #requireClient(): KookClientTransport {
    if (!this.#client) throw new Error('KOOK client not connected');
    return this.#client;
  }
}

export interface KookWebhookEndpointOptions {
  readonly id: CapabilityId;
  readonly http: HttpHost;
  readonly config: ResolvedKookWebhookConfig;
  readonly createClient?: CreateKookClient;
}

export class KookWebhookEndpoint extends Endpoint<KookClientTransport> {
  #sentConversations = new Map<string, ConversationRef>();
  readonly #logger!: ReturnType<typeof getAdapterLogger>;

  readonly #options: KookWebhookEndpointOptions;
  readonly #createClient: CreateKookClient;
  #client: KookClientTransport | null = null;
  #routeReleases: HttpRouteRegistration[] = [];
  #processedSn = new Set<number>();
  #open = false;
  #started = false;
  readonly management: EndpointManagement = createKookEndpointManagement(() => this.#requireClient());
  readonly control: EndpointControl = Object.freeze<EndpointControl>({
    recall: (message) => recallKookMessage(this.#requireClient(), message),
  });

  constructor(options: KookWebhookEndpointOptions) {
    super();
    this.#logger = getAdapterLogger('kook', options.config.id);
    this.#options = options;
    this.#createClient = options.createClient ?? (defaultCreateWebhookClient as CreateKookClient);
  }

  get client(): KookClientTransport {
    return this.#requireClient();
  }

  /** Used by webhook handler. */
  get isOpen(): boolean {
    return this.#open;
  }

  get config(): ResolvedKookWebhookConfig {
    return this.#options.config;
  }

  get selfId(): string | undefined {
    return this.#client?.self_id != null ? String(this.#client.self_id) : undefined;
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    try {
      this.#client = this.#createClient(this.#options.config);
      await (this.#client as Client).init();
      this.#routeReleases.push(...registerKookWebhookRoutes(this.#options.http, this));
      this.#logger.info(formatCompact({
        op: 'connect',
        endpoint: this.#options.config.id,
        mode: 'webhook',
        path: this.#options.config.webhookPath,
        self_id: this.#client.self_id != null ? String(this.#client.self_id) : undefined,
      }));
    } catch (error) {
      await this.stop();
      this.#logger.error('Failed to connect KOOK webhook:', error);
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
    this.#sentConversations.clear();
    for (const release of this.#routeReleases.splice(0)) release();
    this.#processedSn.clear();
    if (this.#client) {
      try {
        this.#client.removeAllListeners();
        await this.#client.disconnect();
      } catch {
        /* ignore */
      }
      this.#client = null;
    }
    this.#started = false;
    this.#logger.debug(formatCompact({ op: 'disconnect' }));
  }

  async send({ conversation, payload }: EndpointSendRequest): Promise<string> {
    const messageId = await sendKookOutbound(this.#requireClient(), { conversation, payload });
    rememberKookConversation(this.#sentConversations, messageId, conversation);
    this.#logger.debug(formatCompact({
      op: 'kook_send',
      endpoint: this.#options.config.id,
      target: `${conversation.kind}:${conversation.id}`,
      messageId,
    }));
    return messageId;
  }

  async admitEvent(event: KookWebhookEventData): Promise<void> {
    if (normalizeKookButtonEvent(event)) {
      if (!this.#open) throw new Error('KOOK endpoint is closed');
      const button = normalizeKookButtonEvent(event)!;
      await this.emitAccepted('message.receive', kookButtonIngress(String(this.#options.id), this.#options.config.id, button, this.#sentConversations.get(button.sourceMessageId)));
      return;
    }
    void this.emitPlatform(String(event.type ?? 'event'), event).catch((error) => {
      this.#logger.warn(formatCompact({
        op: 'kook_platform_event_failed',
        event: String(event.type ?? 'event'),
        error: error instanceof Error ? error.message : String(error),
      }));
    });
    if (receiveKookSideEvent(
      (name, payload) => this.emit(name, payload),
      this.#options.config.id,
      event,
      this.#logger,
    )) return;
    const message = normalizeKookWebhookEvent(event, {
      ignore: this.#options.config.ignore,
      selfId: this.selfId,
    });
    if (message) this.admit(message);
  }

  /** Test / internal: admit a message when open. */
  admit(msg: KookInboundMessage): void {
    if (!this.#open) return;
    if (msg.authorBot) return;
    const conversation = kookInboundConversation(String(this.#options.id), msg);
    const selfId = this.#client?.self_id != null ? String(this.#client.self_id) : undefined;
    void this.emit('message.receive', {
      conversation,
      message: { conversation, id: msg.id },
      content: formatInboundContent(msg),
      sender: {
        id: msg.authorId,
        name: senderDisplayName(msg) || undefined,
        ...(msg.authorRoles?.length ? { roles: msg.authorRoles.map(String) } : {}),
      },
      endpointId: this.#options.config.id,
      ...(isKookBotMentioned(msg, selfId) ? { mentioned: true } : {}),
      metadata: Object.freeze({
        channelKind: msg.channelKind,
        userId: msg.authorId,
        guildId: msg.guildId,
        roles: msg.authorRoles,
      }),
    }).catch((err) => {
      this.#logger.warn(formatCompact({
        op: 'kook_gateway_receive_failed',
        target: `${conversation.kind}:${conversation.id}`,
        error: err instanceof Error ? err.message : String(err),
      }));
    });
  }

  async recallMessage(messageId: string, conversation?: ConversationRef): Promise<void> {
    if (!conversation) throw new EndpointDeliveryError('unsupported_operation', 'KOOK recall requires conversation routing', 'rejected');
    await recallKookMessage(this.#requireClient(), { id: messageId, conversation });
  }

  checkAndRememberSn(sn: number): boolean {
    if (this.#processedSn.has(sn)) return false;
    this.#processedSn.add(sn);
    if (this.#processedSn.size > 1024) {
      const first = this.#processedSn.values().next().value;
      if (first != null) this.#processedSn.delete(first);
    }
    return true;
  }

  forgetSn(sn: number): void { this.#processedSn.delete(sn); }

  #requireClient(): KookClientTransport {
    if (!this.#client) throw new Error('KOOK client not initialized');
    return this.#client;
  }
}

/**
 * KOOK guild/channel/user id 是字符串形式的雪花号，超出
 * Number.MAX_SAFE_INTEGER，Number() 会丢精度。Console 社交面只把 group_id
 * 当 JSON 值透传、并以字符串回传给 listGroupMembers，因此保留原始字符串
 * （仅按契约类型声明强转）是全链路最不丢信息的方案。
 */
function toGroupId(id: string): number {
  return id as unknown as number;
}

/** KOOK 文字频道标记：HTTP API type=1（2=语音），kook-client 消息侧用 'GROUP'。 */
function rememberKookConversation(cache: Map<string, ConversationRef>, messageId: string, conversation: ConversationRef): void {
  cache.set(messageId, conversation);
  while (cache.size > 2048) cache.delete(cache.keys().next().value!);
}

function kookButtonIngress(endpointKey: string, endpointId: string, event: NonNullable<ReturnType<typeof normalizeKookButtonEvent>>, sentConversation?: ConversationRef) {
  const conversation: ConversationRef = { endpoint: { id: endpointKey, adapter: endpointKey.split('\0')[0] ?? endpointKey },
    kind: sentConversation?.kind ?? event.channelKind, id: sentConversation?.id ?? event.channelId,
    ...(sentConversation?.parent ? { parent: sentConversation.parent } : {}) };
  return { conversation, message: { conversation, id: event.id }, content: `[action: ${event.payload}]`,
    segments: [{ type: 'action', data: { id: event.id, payload: event.payload, sourceMessageId: event.sourceMessageId } }],
    sender: { id: event.userId }, endpointId,
    metadata: Object.freeze({ eventType: 'message_btn_click', payload: event.payload, sourceMessageId: event.sourceMessageId, timestamp: event.timestamp }) };
}

function isKookTextChannelType(type: string | number | undefined): boolean {
  return type === 1 || type === '1' || type === 'GROUP';
}

/**
 * KOOK endpoint 的 EndpointManagement 语义端口（websocket / webhook 共用）。
 * 数据走 kook-client 的 HTTP API 封装：/api/v3/guild/list、
 * /api/v3/channel/list、/api/v3/guild/user-list（SDK 内部已做分页聚合）。
 */
export function createKookEndpointManagement(
  requireClient: () => KookClientTransport,
): EndpointManagement {
  return Object.freeze<EndpointManagement>({
    async listGroups(): Promise<readonly EndpointGroup[]> {
      const guilds = await requireClient().getGuildList();
      const groups: EndpointGroup[] = [];
      for (const guild of guilds) {
        if (guild?.id == null) continue;
        groups.push({
          group_id: toGroupId(String(guild.id)),
          name: String(guild.name ?? guild.id),
        });
      }
      return groups;
    },
    async listChannels(): Promise<readonly EndpointChannel[]> {
      const client = requireClient();
      const channels: EndpointChannel[] = [];
      for (const guild of await client.getGuildList()) {
        if (guild?.id == null) continue;
        const guildId = String(guild.id);
        const guildName = String(guild.name ?? guildId);
        for (const channel of await client.getChannelList(guildId)) {
          if (channel?.id == null) continue;
          if (channel.is_category) continue;
          if (!isKookTextChannelType(channel.type)) continue;
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
      // 平台形状（User.Info[]）原样返回
      return requireClient().getGuildUserList(groupId);
    },
  });
}
