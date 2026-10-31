import { EndpointDeliveryError, type ConversationRef } from '@zhin.js/im-contract';
/**
 * KookEndpoint — lifecycle, outbound, admit, OpenAPI helpers for agent tools.
 */
import {
  createEndpointSpecification,
  endpointSpec,
  type Endpoint,
  type EndpointSpecification,
  type EndpointControl,
  type EndpointChannel,
  type EndpointGroup,
  type EndpointManagement,
  type EndpointSendRequest,
  type EndpointTransportState,
  type EndpointManagementRequest,
  createEndpointOperation,
  type EndpointGroupRequest,
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
  RuntimeKookClient, kookWebsocketClientOptions, kookWebhookClientOptions,
  normalizeKookMessage,
  type KookClientTransport,
} from './ws.js';
import { recallKookMessage, sendKookOutbound } from './outbound.js';
import { KookSenderRoleResolver, type KookSenderRoleProjection } from './sender-roles.js';
import { receiveKookSideEvent } from './side-event-dispatch.js';

export interface KookEndpointOptions {
  readonly id: CapabilityId;
  readonly config: ResolvedKookWebsocketConfig;
}

/** 入站 message.receive 载荷：规范角色 owner/admin 进 roles，原始角色 id 进 permissions。 */
function kookInboundPayload(
  endpointId: string,
  conversation: ConversationRef,
  msg: KookInboundMessage,
  projection: KookSenderRoleProjection,
  selfId: string | undefined,
) {
  return {
    conversation,
    event: msg.event,
    platformSentAt: msg.platformSentAt,
    message: { conversation, id: msg.id },
    content: formatInboundContent(msg),
    sender: {
      id: msg.authorId,
      name: senderDisplayName(msg) || undefined,
      ...(projection.role ? { roles: [projection.role] } : {}),
      ...(projection.permissions.length ? { permissions: [...projection.permissions] } : {}),
    },
    endpointId,
    ...(isKookBotMentioned(msg, selfId) ? { mentioned: true } : {}),
    metadata: Object.freeze({
      channelKind: msg.channelKind,
      userId: msg.authorId,
      guildId: msg.guildId,
      authorRoleIds: msg.authorRoles,
      ...(projection.role ? { senderRole: projection.role } : {}),
    }),
  };
}

export class KookWebsocketEndpoint extends RuntimeKookClient implements Endpoint {
  readonly [endpointSpec]: EndpointSpecification;
  #sentConversations = new Map<string, ConversationRef>();
  readonly #logger!: ReturnType<typeof getAdapterLogger>;

  readonly #options: KookEndpointOptions;
  readonly #roles = new KookSenderRoleResolver(() => this);
  #open = false;
  #executionSignal?: AbortSignal;
  #started = false;
  readonly #management: EndpointManagement = createKookEndpointManagement(() => this.#requireClient());
  readonly #control: EndpointControl = Object.freeze<EndpointControl>({
    recall: request => recallKookMessage(this.#requireClient(), request),
  });

  constructor(options: KookEndpointOptions) {
    super(kookWebsocketClientOptions(options.config), undefined, options.config.apiProxy);
    this.#logger = getAdapterLogger('kook', options.config.id);
    this.#options = options;
    const endpoint = this;
    this[endpointSpec] = createEndpointSpecification(this, {
      start: signal => this.#startFramework(signal), open: () => this.#openFramework(), close: () => this.#closeFramework(),
      stop: () => this.#stopFramework(), send: request => this.#sendFramework(request),
      name: options.config.id, get transportState() { return endpoint.#transportState; },
      management: this.#management, control: this.#control,
    });
  }

  get #transportState(): EndpointTransportState | undefined {
    if (!this.#started) return 'stopped';
    return this.getTransportState?.();
  }

  async #startFramework(signal: AbortSignal): Promise<void> {
    this.#executionSignal = signal;
    this.request.interceptors.request.use(request => { request.signal = signal; return request; });
    if (this.#started) return;
    this.#started = true;
    try {
      this.#bindClient(this);
      await this.connect();
      this.#logger.info(formatCompact({
        op: 'connect',
        endpoint: this.#options.config.id,
        mode: 'websocket',
        self_id: this.self_id != null ? String(this.self_id) : undefined,
      }));
    } catch (error) {
      await this.#stopFramework();
      this.#logger.error('Failed to connect KOOK websocket:', error);
      throw error;
    }
  }

  #openFramework(): void {
    this.#open = true;
  }

  #closeFramework(): void {
    this.#open = false;
  }

  async #stopFramework(): Promise<void> {
    this.#open = false;
    this.#sentConversations.clear();
    this.removeAllListeners();
    await this.disconnect();
    this.#started = false;
    this.#logger.debug(formatCompact({ op: 'disconnect' }));
  }

  async #sendFramework(request: EndpointSendRequest): Promise<string> {
    const { conversation } = request;
    const messageId = await sendKookOutbound(this.#requireClient(), request);
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
    void this[endpointSpec].events.run(() => {
      if (msg.authorBot) return;
      const conversation = kookInboundConversation(String(this.#options.id), msg);
      const selfId = this.self_id != null ? String(this.self_id) : undefined;
      return this.#roles.resolve(msg).then((projection) => {
        this.#executionSignal?.throwIfAborted();
        return this[endpointSpec].events.emit('message.receive',
          kookInboundPayload(this.#options.config.id, conversation, msg, projection, selfId));
      }).catch((err) => {
        this.#logger.warn(formatCompact({
          op: 'kook_gateway_receive_failed',
          target: `${conversation.kind}:${conversation.id}`,
          error: err instanceof Error ? err.message : String(err),
        }));
      });
    }).catch(() => this.#logger.debug('Inbound callback was not admitted'));
  }

  async recallMessage(messageId: string, conversation?: ConversationRef): Promise<void> {
    if (!conversation) throw new EndpointDeliveryError('unsupported_operation', 'KOOK recall requires conversation routing', 'rejected');
    await recallKookMessage(this.#requireClient(), { message: { id: messageId, conversation } });
  }

  #bindClient(client: KookClientTransport): void {
    client.on('message', (raw) => {
      void this[endpointSpec].events.run(() => {
        this.#emitPlatformEvent('message', raw);
        const msg = normalizeKookMessage(raw);
        if (msg) this.admit(msg);
      }).catch(() => this.#logger.debug('Native callback was not admitted'));
    });
    const receiver = (client as { receiver?: { on(event: string, listener: (...args: unknown[]) => void): void } }).receiver;
    receiver?.on('event', (raw) => {
      void this[endpointSpec].events.run(() => {
        if (this !== client || !this.#open) return;
        this.#emitPlatformEvent('event', raw);
        if (normalizeKookButtonEvent(raw)) {
          void this.admitButton(raw).catch(error => this.#logger.warn(formatCompact({ op: 'kook_button_failed', error: error instanceof Error ? error.message : 'dispatch failed' })));
          return;
        }
        receiveKookSideEvent((name, payload) => this[endpointSpec].events.emit(name, payload), this.#options.config.id, raw, this.#logger);
      }).catch(() => this.#logger.debug('Native callback was not admitted'));
    });
  }

  async admitButton(raw: unknown): Promise<void> {
    return this[endpointSpec].events.run(async () => {
      const event = normalizeKookButtonEvent(raw);
      if (!event) throw new Error('Invalid KOOK button event');
      await this[endpointSpec].events.emitAccepted('message.receive', kookButtonIngress(String(this.#options.id), this.#options.config.id, event, this.#sentConversations.get(event.sourceMessageId)));
    });
  }

  #emitPlatformEvent(name: string, event: unknown): void {
    void this[endpointSpec].events.platform(name, event).catch((error) => {
      this.#logger.warn(formatCompact({
        op: 'kook_platform_event_failed',
        event: name,
        error: error instanceof Error ? error.message : String(error),
      }));
    });
  }

  #requireClient(): KookClientTransport {
    if (!this.#started) throw new Error('KOOK client not connected');
    return this;
  }
}

export interface KookWebhookEndpointOptions {
  readonly id: CapabilityId;
  readonly http: HttpHost;
  readonly config: ResolvedKookWebhookConfig;
}

export class KookWebhookEndpoint extends RuntimeKookClient implements Endpoint {
  readonly [endpointSpec]: EndpointSpecification;
  #sentConversations = new Map<string, ConversationRef>();
  readonly #logger!: ReturnType<typeof getAdapterLogger>;

  readonly #options: KookWebhookEndpointOptions;
  readonly #roles = new KookSenderRoleResolver(() => this);
  #routeReleases: HttpRouteRegistration[] = [];
  #processedSn = new Set<number>();
  #open = false;
  #executionSignal?: AbortSignal;
  #started = false;
  readonly #management: EndpointManagement = createKookEndpointManagement(() => this.#requireClient());
  readonly #control: EndpointControl = Object.freeze<EndpointControl>({
    recall: request => recallKookMessage(this.#requireClient(), request),
  });

  constructor(options: KookWebhookEndpointOptions) {
    super(kookWebhookClientOptions(options.config), undefined, options.config.apiProxy);
    this.#logger = getAdapterLogger('kook', options.config.id);
    this.#options = options;
    this[endpointSpec] = createEndpointSpecification(this, {
      start: signal => this.#startFramework(signal), open: () => this.#openFramework(), close: () => this.#closeFramework(),
      stop: () => this.#stopFramework(), send: request => this.#sendFramework(request), name: options.config.id,
      management: this.#management, control: this.#control,
    });
  }

  /** Used by webhook handler. */
  get isOpen(): boolean {
    return this.#open;
  }

  get endpointConfig(): ResolvedKookWebhookConfig {
    return this.#options.config;
  }

  get selfId(): string | undefined {
    return this.self_id != null ? String(this.self_id) : undefined;
  }

  async #startFramework(signal: AbortSignal): Promise<void> {
    this.#executionSignal = signal;
    this.request.interceptors.request.use(request => { request.signal = signal; return request; });
    if (this.#started) return;
    this.#started = true;
    try {
      await this.init();
      this.#routeReleases.push(...registerKookWebhookRoutes(this.#options.http, this));
      this.#logger.info(formatCompact({
        op: 'connect',
        endpoint: this.#options.config.id,
        mode: 'webhook',
        path: this.#options.config.webhookPath,
        self_id: this.self_id != null ? String(this.self_id) : undefined,
      }));
    } catch (error) {
      await this.#stopFramework();
      this.#logger.error('Failed to connect KOOK webhook:', error);
      throw error;
    }
  }

  #openFramework(): void {
    this.#open = true;
  }

  #closeFramework(): void {
    this.#open = false;
  }

  async #stopFramework(): Promise<void> {
    this.#open = false;
    this.#sentConversations.clear();
    for (const release of this.#routeReleases.splice(0)) release();
    this.#processedSn.clear();
    this.removeAllListeners();
    await this.disconnect();
    this.#started = false;
    this.#logger.debug(formatCompact({ op: 'disconnect' }));
  }

  async #sendFramework(request: EndpointSendRequest): Promise<string> {
    const { conversation } = request;
    const messageId = await sendKookOutbound(this.#requireClient(), request);
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
    return this[endpointSpec].events.run(async () => {
      if (normalizeKookButtonEvent(event)) {
        if (!this.#open) throw new Error('KOOK endpoint is closed');
        const button = normalizeKookButtonEvent(event)!;
        await this[endpointSpec].events.emitAccepted('message.receive', kookButtonIngress(String(this.#options.id), this.#options.config.id, button, this.#sentConversations.get(button.sourceMessageId)));
        return;
      }
      void this[endpointSpec].events.platform(String(event.type ?? 'event'), event).catch((error) => {
        this.#logger.warn(formatCompact({
          op: 'kook_platform_event_failed',
          event: String(event.type ?? 'event'),
          error: error instanceof Error ? error.message : String(error),
        }));
      });
      if (receiveKookSideEvent(
        (name, payload) => this[endpointSpec].events.emit(name, payload),
        this.#options.config.id,
        event,
        this.#logger,
      )) return;
      const message = normalizeKookWebhookEvent(event, {
        ignore: this.#options.config.ignore,
        selfId: this.selfId,
      });
      if (message) this.admit(message);
    });
  }

  /** Test / internal: admit a message when open. */
  admit(msg: KookInboundMessage): void {
    void this[endpointSpec].events.run(() => {
      if (msg.authorBot) return;
      const conversation = kookInboundConversation(String(this.#options.id), msg);
      const selfId = this.self_id != null ? String(this.self_id) : undefined;
      return this.#roles.resolve(msg).then((projection) => {
        this.#executionSignal?.throwIfAborted();
        return this[endpointSpec].events.emit('message.receive',
          kookInboundPayload(this.#options.config.id, conversation, msg, projection, selfId));
      }).catch((err) => {
        this.#logger.warn(formatCompact({
          op: 'kook_gateway_receive_failed',
          target: `${conversation.kind}:${conversation.id}`,
          error: err instanceof Error ? err.message : String(err),
        }));
      });
    }).catch(() => this.#logger.debug('Inbound callback was not admitted'));
  }

  async recallMessage(messageId: string, conversation?: ConversationRef): Promise<void> {
    if (!conversation) throw new EndpointDeliveryError('unsupported_operation', 'KOOK recall requires conversation routing', 'rejected');
    await recallKookMessage(this.#requireClient(), { message: { id: messageId, conversation } });
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
    if (!this.#started) throw new Error('KOOK client not initialized');
    return this;
  }
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
  return { event: event.event, platformSentAt: event.platformSentAt, conversation, message: { conversation, id: event.id }, content: `[action: ${event.payload}]`,
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
    async listGroups(request: EndpointManagementRequest = {}): Promise<readonly EndpointGroup[]> {
      const operation = createEndpointOperation(request);
      const guilds = await operation.run(() => requireClient().getGuildList());
      const groups: EndpointGroup[] = [];
      for (const guild of guilds) {
        if (guild?.id == null) continue;
        groups.push({
          group_id: String(guild.id),
          name: String(guild.name ?? guild.id),
        });
      }
      return groups;
    },
    async listChannels(request: EndpointManagementRequest = {}): Promise<readonly EndpointChannel[]> {
      const operation = createEndpointOperation(request);
      const client = requireClient();
      const channels: EndpointChannel[] = [];
      for (const guild of await operation.run(() => client.getGuildList())) {
        if (guild?.id == null) continue;
        const guildId = String(guild.id);
        const guildName = String(guild.name ?? guildId);
        for (const channel of await operation.run(() => client.getChannelList(guildId))) {
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
    async listGroupMembers({ groupId, signal }: EndpointGroupRequest): Promise<readonly unknown[]> {
      const operation = createEndpointOperation({ signal });
      // 平台形状（User.Info[]）原样返回
      return operation.run(() => requireClient().getGuildUserList(groupId));
    },
  });
}
