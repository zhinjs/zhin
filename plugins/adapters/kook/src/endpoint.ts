/**
 * KookEndpoint — lifecycle, outbound, admit, OpenAPI helpers for agent tools.
 */
import { Client } from 'kook-client';
import type {
  EndpointChannel,
  EndpointGroup,
  EndpointInstance,
  EndpointManagement,
  EndpointSendRequest,
} from 'zhin.js/adapter';
import type { MessageGateway } from '@zhin.js/core/runtime';
import type { HttpHost, HttpRouteRegistration } from '@zhin.js/host-http';
import { formatCompact, getAdapterLogger } from '@zhin.js/logger';
import type { CapabilityId } from 'zhin.js/plugin-runtime';
import { registerKookAgentEndpoint } from './kook-agent-deps.js';
import {
  formatInboundContent,
  formatOutboundKmarkdown,
  isKookBotMentioned,
  kookInboundConversation,
  senderDisplayName,
  type KookInboundMessage,
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

export interface KookEndpointOptions {
  readonly id: CapabilityId;
  readonly gateway: MessageGateway;
  readonly config: ResolvedKookWebsocketConfig;
  readonly createClient?: CreateKookClient;
}

export class KookWebsocketEndpoint implements EndpointInstance {
  readonly #logger!: ReturnType<typeof getAdapterLogger>;

  readonly #options: KookEndpointOptions;
  readonly #createClient: CreateKookClient;
  #client: KookClientTransport | null = null;
  #open = false;
  #started = false;
  #unregisterAgent?: () => void;
  readonly management: EndpointManagement = createKookEndpointManagement(() => this.#requireClient());

  constructor(options: KookEndpointOptions) {
    this.#logger = getAdapterLogger('kook', options.config.id);
    this.#options = options;
    this.#createClient = options.createClient ?? (defaultCreateClient as CreateKookClient);
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    try {
      this.#unregisterAgent = registerKookAgentEndpoint(this.#options.config.id, this);
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
    this.#unregisterAgent?.();
    this.#unregisterAgent = undefined;
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
    const body = formatOutboundKmarkdown(payload);
    const client = this.#requireClient();
    const result = conversation.kind === 'private'
      ? await client.sendPrivateMsg(conversation.id, body)
      : await client.sendChannelMsg(conversation.id, body);
    const messageId = result?.msg_id != null ? String(result.msg_id) : '';
    this.#logger.debug(formatCompact({
      op: 'kook_send',
      endpoint: this.#options.config.id,
      target: `${conversation.kind}:${conversation.id}`,
      messageId,
    }));
    return messageId;
  }

  /** Test / internal: admit a message when open. */
  admit(msg: KookInboundMessage): void {
    if (!this.#open) return;
    if (msg.authorBot) return;
    const conversation = kookInboundConversation(String(this.#options.id), msg);
    const selfId = this.#client?.self_id != null ? String(this.#client.self_id) : undefined;
    void this.#options.gateway.receive({
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

  async recallMessage(messageId: string): Promise<void> {
    if (!messageId) return;
    await this.#requireClient().recallMsg?.(messageId);
  }

  // ── Agent tool surface ──────────────────────────────────────────────

  async getRoleList(guildId: string) {
    return this.#requireClient().pickGuild(guildId).getRoleList();
  }

  async createRole(guildId: string, name: string) {
    return this.#requireClient().pickGuild(guildId).createRole(name);
  }

  async deleteRole(guildId: string, roleId: string) {
    return this.#requireClient().pickGuild(guildId).deleteRole(roleId);
  }

  async grantRole(guildId: string, userId: string, roleId: string) {
    return this.#requireClient().pickGuildMember(guildId, userId).grant(roleId);
  }

  async revokeRole(guildId: string, userId: string, roleId: string) {
    return this.#requireClient().pickGuildMember(guildId, userId).revoke(roleId);
  }

  async addToBlacklist(guildId: string, userId: string, remark?: string) {
    return this.#requireClient().pickGuildMember(guildId, userId).addToBlackList(remark);
  }

  async removeFromBlacklist(guildId: string, userId: string) {
    return this.#requireClient().pickGuildMember(guildId, userId).removeFromBlackList();
  }

  #bindClient(client: KookClientTransport): void {
    client.on('message', (raw) => {
      const msg = normalizeKookMessage(raw);
      if (msg) this.admit(msg);
    });
  }

  #requireClient(): KookClientTransport {
    if (!this.#client) throw new Error('KOOK client not connected');
    return this.#client;
  }
}

export interface KookWebhookEndpointOptions {
  readonly id: CapabilityId;
  readonly gateway: MessageGateway;
  readonly http: HttpHost;
  readonly config: ResolvedKookWebhookConfig;
  readonly createClient?: CreateKookClient;
}

export class KookWebhookEndpoint implements EndpointInstance {
  readonly #logger!: ReturnType<typeof getAdapterLogger>;

  readonly #options: KookWebhookEndpointOptions;
  readonly #createClient: CreateKookClient;
  #client: KookClientTransport | null = null;
  #routeReleases: HttpRouteRegistration[] = [];
  #processedSn = new Set<number>();
  #open = false;
  #started = false;
  #unregisterAgent?: () => void;
  readonly management: EndpointManagement = createKookEndpointManagement(() => this.#requireClient());

  constructor(options: KookWebhookEndpointOptions) {
    this.#logger = getAdapterLogger('kook', options.config.id);
    this.#options = options;
    this.#createClient = options.createClient ?? (defaultCreateWebhookClient as CreateKookClient);
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
      this.#unregisterAgent = registerKookAgentEndpoint(this.#options.config.id, this);
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
    for (const release of this.#routeReleases.splice(0)) release();
    this.#unregisterAgent?.();
    this.#unregisterAgent = undefined;
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
    const body = formatOutboundKmarkdown(payload);
    const client = this.#requireClient();
    const result = conversation.kind === 'private'
      ? await client.sendPrivateMsg(conversation.id, body)
      : await client.sendChannelMsg(conversation.id, body);
    const messageId = result?.msg_id != null ? String(result.msg_id) : '';
    this.#logger.debug(formatCompact({
      op: 'kook_send',
      endpoint: this.#options.config.id,
      target: `${conversation.kind}:${conversation.id}`,
      messageId,
    }));
    return messageId;
  }

  /** Test / internal: admit a message when open. */
  admit(msg: KookInboundMessage): void {
    if (!this.#open) return;
    if (msg.authorBot) return;
    const conversation = kookInboundConversation(String(this.#options.id), msg);
    const selfId = this.#client?.self_id != null ? String(this.#client.self_id) : undefined;
    void this.#options.gateway.receive({
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

  async recallMessage(messageId: string): Promise<void> {
    if (!messageId) return;
    await this.#requireClient().recallMsg?.(messageId);
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

  async getRoleList(guildId: string) {
    return this.#requireClient().pickGuild(guildId).getRoleList();
  }

  async createRole(guildId: string, name: string) {
    return this.#requireClient().pickGuild(guildId).createRole(name);
  }

  async deleteRole(guildId: string, roleId: string) {
    return this.#requireClient().pickGuild(guildId).deleteRole(roleId);
  }

  async grantRole(guildId: string, userId: string, roleId: string) {
    return this.#requireClient().pickGuildMember(guildId, userId).grant(roleId);
  }

  async revokeRole(guildId: string, userId: string, roleId: string) {
    return this.#requireClient().pickGuildMember(guildId, userId).revoke(roleId);
  }

  async addToBlacklist(guildId: string, userId: string, remark?: string) {
    return this.#requireClient().pickGuildMember(guildId, userId).addToBlackList(remark);
  }

  async removeFromBlacklist(guildId: string, userId: string) {
    return this.#requireClient().pickGuildMember(guildId, userId).removeFromBlackList();
  }

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
