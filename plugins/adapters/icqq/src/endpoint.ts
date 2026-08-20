import {
  Client,
  parseGroupMessageId,
  type Config as NativeIcqqClientConfig,
  type Sendable,
} from '@icqqjs/icqq';
import { inspect } from 'node:util';
import type {
  EndpointControl,
  EndpointInstance,
  EndpointManagement,
  EndpointSendRequest,
} from 'zhin.js/adapter';
import type { MessageGateway } from '@zhin.js/core/runtime';
import type { MessageRef } from '@zhin.js/im-contract';
import { formatCompact, getAdapterLogger, truncatePreview } from '@zhin.js/logger';
import type { CapabilityId } from 'zhin.js/plugin-runtime';
import { registerIcqqAgentEndpoint } from './icqq-agent-deps.js';
import {
  InboundMessageDeduper,
  findIcqqNestedMessageSource,
  isIcqqBotMentioned,
  isIcqqMessagePostType,
  normalizeIcqqInboundMessage,
  quotedPayloadFromIcqqSource,
  resolveIcqqQuoteIdFromEvent,
  shouldSkipSelfInboundMessage,
  type IcqqMessageEvent,
} from './icqq-inbound.js';
import {
  buildIcqqInboxNoticeRow,
  buildIcqqInboxRequestRow,
  buildIcqqSystemRequestRow,
  isIcqqNoticePayload,
  isIcqqRequestPayload,
} from './icqq-inbox.js';
import {
  IcqqGuildCatalog,
  normalizeIcqqGuildInboundMessage,
} from './icqq-guild.js';
import {
  materializeOutboundBase64,
  resolveIcqqOutboundMediaMode,
} from './outbound-media.js';
import {
  formatInboundContent,
  formatOutboundBody,
  icqqInboundConversation,
  icqqOutboundTarget,
  type IcqqInboundMessage,
  type ResolvedIcqqConfig,
} from './protocol.js';
import type { SystemMessage as IcqqSystemMessage } from './types.js';

export interface IcqqInboxHooks {
  recordRequest(row: Record<string, unknown>): void | Promise<void>;
  recordNotice(row: Record<string, unknown>): void | Promise<void>;
  publish?(type: string, data: unknown): void;
}

export interface IcqqEndpointOptions {
  readonly id: CapabilityId;
  readonly gateway: MessageGateway;
  readonly config: ResolvedIcqqConfig;
  readonly inbox?: IcqqInboxHooks;
}

const BOUND_EVENTS = [
  'message.private',
  'message.group',
  'message.guild',
  'request.friend',
  'request.group',
  'notice.friend',
  'notice.group',
  'system.online',
  'system.offline',
  'system.offline.network',
  'system.offline.kickoff',
  'system.login.qrcode',
  'system.login.device',
  'system.login.slider',
  'system.login.error',
  'system.login.auth',
] as const;

export class IcqqEndpoint extends Client implements EndpointInstance {
  readonly #logger: ReturnType<typeof getAdapterLogger>;
  readonly #options: IcqqEndpointOptions;
  readonly endpointName: string;
  readonly #guildCatalog = new IcqqGuildCatalog();
  readonly #inboundDeduper = new InboundMessageDeduper();
  readonly #inboxDeduper = new InboundMessageDeduper();
  #open = false;
  #started = false;
  #heldInbound: IcqqInboundMessage[] = [];
  #unregisterAgent?: () => void;

  readonly management: EndpointManagement = Object.freeze<EndpointManagement>({
    listFriends: async () =>
      Array.from(this.fl.values()).map((f) => ({
        user_id: f.user_id,
        nickname: f.nickname,
        remark: f.remark ?? '',
      })),
    listGroups: async () =>
      Array.from(this.gl.values()).map((g) => ({
        group_id: g.group_id,
        name: g.group_name,
      })),
    listChannels: async () => {
      await this.#guildCatalog.syncAll(this);
      return this.#guildCatalog.getGuildChannelList();
    },
    listGroupMembers: async (groupId) =>
      Array.from((await this.getGroupMemberList(Number(groupId))).values()),
    approveRequest: (requestId, remark) => this.#approveRequest(requestId, remark),
    rejectRequest: (requestId, reason) => this.#rejectRequest(requestId, reason),
    kickGroupMember: async (groupId, userId) => {
      await this.setGroupKick(Number(groupId), Number(userId));
    },
    muteGroupMember: async (groupId, userId, duration) => {
      await this.setGroupBan(Number(groupId), Number(userId), duration);
    },
    setGroupAdmin: async (groupId, userId, enabled) => {
      await this.setGroupAdmin(Number(groupId), Number(userId), enabled);
    },
    deleteFriend: async (userId) => {
      await this.deleteFriend(Number(userId));
    },
  });

  readonly control: EndpointControl = Object.freeze({
    recall: async (message: MessageRef) => {
      if (!message.id || message.id.startsWith('outbound:')) return;
      await this.deleteMsg(message.id);
    },
    addReaction: async (message: MessageRef, emoji: string) => {
      const target = resolveIcqqGroupReactionTarget(message);
      if (!target) return null;
      try {
        // Do not await protocol ACK — packet timeout must not stall the AI reply.
        this.#ignoreReactionAck(
          'add',
          this.pickGroup(target.groupId).setReaction(target.seq, emoji),
        );
      } catch (error) {
        this.#logger.debug(formatCompact({
          op: 'reaction_add_failed',
          error: error instanceof Error ? error.message : String(error),
        }));
      }
      return emoji;
    },
    removeReaction: async (message: MessageRef, reactionId: string) => {
      const target = resolveIcqqGroupReactionTarget(message);
      if (!target) return;
      try {
        this.#ignoreReactionAck(
          'remove',
          this.pickGroup(target.groupId).delReaction(target.seq, reactionId),
        );
      } catch (error) {
        this.#logger.debug(formatCompact({
          op: 'reaction_remove_failed',
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    },
  });

  constructor(options: IcqqEndpointOptions) {
    const nativeConfig = resolveNativeClientConfig(options.config);
    super(Number(options.config.id), nativeConfig);
    this.#logger = getAdapterLogger('icqq', options.config.id);
    this.#options = options;
    this.endpointName = options.config.id;
  }

  #ignoreReactionAck(action: 'add' | 'remove', task: Promise<unknown> | unknown): void {
    void Promise.resolve(task).catch((error) => {
      this.#logger.debug(formatCompact({
        op: `reaction_${action}_failed`,
        error: error instanceof Error ? error.message : String(error),
      }));
    });
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    try {
      const onlineReady = new Promise<void>((resolve) => {
        this.on('system.online', () => resolve());
      });
      this.#bindClientEvents();
      await this.login(this.#options.config.password);
      await onlineReady;
      await this.#pullPendingSystemMessages();
      this.#unregisterAgent = registerIcqqAgentEndpoint(this.endpointName, this);
      this.#logger.info(
        `connected (direct) | friends: ${this.fl.size} | groups: ${this.gl.size}`,
      );
    } catch (error) {
      await this.stop();
      this.#logger.debug(`Failed to connect ICQQ client: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      throw error;
    }
  }

  open(): void {
    this.#open = true;
    const held = this.#heldInbound.splice(0);
    for (const msg of held) this.admit(msg);
  }

  close(): void {
    this.#open = false;
  }

  async stop(): Promise<void> {
    this.#open = false;
    this.#heldInbound.length = 0;
    this.#unregisterAgent?.();
    this.#unregisterAgent = undefined;
    for (const event of BOUND_EVENTS) this.off(event);
    try {
      await this.logout?.();
    } catch { /* ignore */ }
    try {
      this.terminate();
    } catch { /* ignore */ }
    this.#inboundDeduper.clear();
    this.#inboxDeduper.clear();
    this.#guildCatalog.clear();
    this.#started = false;
    this.#logger.debug(formatCompact({ op: 'disconnect' }));
  }

  async send({ conversation, payload }: EndpointSendRequest): Promise<string> {
    if (!this.#started) throw new Error('icqq endpoint 未连接');
    const mediaMode = resolveIcqqOutboundMediaMode(this.#options.config);
    const content = Array.isArray(payload)
      ? materializeOutboundBase64(payload, mediaMode)
      : payload;
    const message = formatOutboundBody(content);
    const parsed = icqqOutboundTarget(conversation);
    let result: { message_id?: unknown };
    try {
      switch (parsed.kind) {
        case 'private':
          result = await this.sendPrivateMsg(parsed.userId, message as Sendable);
          break;
        case 'group':
          result = await this.sendGroupMsg(parsed.groupId, message as Sendable);
          break;
        case 'temp':
          result = await this.sendTempMsg(parsed.groupId, parsed.userId, message as Sendable);
          break;
        case 'channel':
          result = await this.sendGuildMsg(parsed.guildId, parsed.channelId, message as Sendable) as unknown as { message_id?: unknown };
          break;
      }
    } catch (error) {
      this.#logger.warn(formatCompact({
        op: 'icqq_send_failed',
        target: `${conversation.kind}:${conversation.id}`,
        error: describeUnknownError(error),
        preview: truncatePreview(typeof message === 'string' ? message : String(message), 120),
      }));
      throw error;
    }
    const messageId = String(result?.message_id ?? `sent_${Date.now()}`);
    this.#logger.info(
      `send ${conversation.kind}:${conversation.id} | id: ${messageId} | ${truncatePreview(typeof message === 'string' ? message : String(message), 80)}`,
    );
    return messageId;
  }

  admit(msg: IcqqInboundMessage): void {
    const conversation = msg.conversation;
    if (!this.#open) {
      if (this.#heldInbound.length >= INBOUND_HOLD_LIMIT) {
        const dropped = this.#heldInbound.shift();
        this.#logger.warn(formatCompact({
          op: 'icqq_inbound_hold_drop',
          endpoint: this.endpointName,
          id: dropped?.id,
          target: dropped
            ? `${dropped.conversation.kind}:${dropped.conversation.id}`
            : undefined,
          limit: INBOUND_HOLD_LIMIT,
        }));
      }
      this.#heldInbound.push(msg);
      this.#logger.info(
        `hold ${conversation.kind}:${conversation.id}`
        + (msg.sender ? ` from ${msg.sender.name ?? msg.sender.id}` : '')
        + ` until open | ${truncatePreview(msg.content, 80)}`,
      );
      return;
    }
    const mentioned = isIcqqBotMentioned({
      uin: this.endpointName,
      content: msg.segments,
      rawMessage: msg.content,
    });
    this.#logger.info(
      `recv ${conversation.kind}:${conversation.id}`
      + (msg.sender ? ` from ${msg.sender.name ?? msg.sender.id}` : '')
      + (mentioned ? ' (mentioned)' : '')
      + ` | ${truncatePreview(msg.content, 80)}`,
    );
    const quoteId = msg.metadata?.quote_id;
    const { quote_id: _dropQuoteId, ...restMetadata } = msg.metadata ?? {};
    void this.#options.gateway.receive({
      conversation,
      message: { conversation, id: msg.id },
      content: msg.content,
      ...(msg.segments ? { segments: msg.segments } : {}),
      sender: msg.sender,
      endpointId: this.endpointName,
      ...(mentioned ? { mentioned: true } : {}),
      ...(quoteId ? { replyTo: { id: String(quoteId) } } : {}),
      metadata: Object.freeze({
        channelType: msg.channelType,
        ...restMetadata,
      }),
    }).catch((err) => {
      this.#logger.warn(formatCompact({
        op: 'recv',
        endpoint: this.endpointName,
        target: `${conversation.kind}:${conversation.id}`,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      }));
    });
  }

  #bindClientEvents(): void {
    const safe = (label: string, fn: () => void): void => {
      try {
        fn();
      } catch (error) {
        this.#logger.warn(formatCompact({
          op: 'icqq_event_handler',
          endpoint: this.endpointName,
          event: label,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    };
    this.on('message.private', (event) => safe('message.private', () => this.#handleMessageEvent('message.private', event)));
    this.on('message.group', (event) => safe('message.group', () => this.#handleMessageEvent('message.group', event)));
    this.on('message.guild', (event) => safe('message.guild', () => this.#handleGuildEvent(event)));
    this.on('request.friend', (event) => safe('request.friend', () => this.#recordInboxRequest(serializeIcqqEvent(event))));
    this.on('request.group', (event) => safe('request.group', () => this.#recordInboxRequest(serializeIcqqEvent(event))));
    this.on('notice.friend', (event) => safe('notice.friend', () => this.#recordInboxNotice(serializeIcqqEvent(event))));
    this.on('notice.group', (event) => safe('notice.group', () => this.#recordInboxNotice(serializeIcqqEvent(event))));
    this.on('system.offline', (event) => this.#logSystemEvent('offline', event));
    this.on('system.offline.network', (event) => this.#logSystemEvent('offline.network', event));
    this.on('system.offline.kickoff', (event) => this.#logSystemEvent('offline.kickoff', event));
    this.on('system.login.qrcode', () => {
      this.#logger.info('icqq 收到二维码登录事件，请按 icqq 默认流程扫码后继续登录');
    });
    this.on('system.login.device', (event) => this.#logSystemEvent('login.device', event));
    this.on('system.login.slider', (event) => this.#logSystemEvent('login.slider', event));
    this.on('system.login.error', (event) => this.#logSystemEvent('login.error', event));
    this.on('system.login.auth', (event) => this.#logSystemEvent('login.auth', event));
  }

  #logSystemEvent(type: string, event: unknown): void {
    const payload = serializeIcqqEvent(event);
    this.#logger.warn(formatCompact({
      op: `system.${type}`,
      endpoint: this.endpointName,
      ...(payload ? { event: JSON.stringify(payload) } : {}),
    }));
  }

  #handleMessageEvent(eventName: 'message.private' | 'message.group', event: unknown): void {
    const payload = serializeIcqqEvent(event);
    if (!payload || !isIcqqMessagePostType(payload)) {
      this.#logger.debug(formatCompact({
        op: 'icqq_inbound_skip',
        reason: payload ? 'not_message_post' : 'serialize_failed',
        endpoint: this.endpointName,
        event: eventName,
      }));
      return;
    }
    const data = payload as IcqqMessageEvent;
    if (shouldSkipSelfInboundMessage(data)) {
      this.#logger.debug(formatCompact({
        op: 'icqq_inbound_skip',
        reason: 'self',
        endpoint: this.endpointName,
        user_id: data.user_id,
        self_id: data.self_id,
      }));
      return;
    }
    const normalized = normalizeIcqqInboundMessage(data);
    if (!normalized) {
      this.#logger.debug(formatCompact({
        op: 'icqq_inbound_skip',
        reason: 'normalize_failed',
        endpoint: this.endpointName,
        event: eventName,
        message_id: data.message_id,
      }));
      return;
    }
    if (!this.#inboundDeduper.shouldProcess(normalized.messageId)) {
      this.#logger.debug(formatCompact({
        op: 'icqq_inbound_skip',
        reason: 'dedupe',
        endpoint: this.endpointName,
        id: normalized.messageId,
      }));
      return;
    }
    this.admit({
      id: normalized.messageId,
      conversation: icqqInboundConversation(String(this.#options.id), {
        channelType: normalized.channelType,
        channelId: normalized.channelId,
        channelParentGroupId: normalized.channelParentGroupId,
      }),
      content: formatInboundContent(normalized.rawMessage),
      segments: normalized.content,
      sender: {
        id: normalized.userId,
        name: normalized.nickname || undefined,
        ...(normalized.senderRole ? { roles: [normalized.senderRole] } : {}),
      },
      channelType: normalized.channelType,
      metadata: buildIcqqQuoteMetadata(data, {
        nickname: normalized.nickname,
        senderRole: normalized.senderRole,
      }),
    });
  }

  #handleGuildEvent(event: unknown): void {
    const payload = serializeIcqqEvent(event);
    if (!payload || typeof payload !== 'object') return;
    const normalized = normalizeIcqqGuildInboundMessage(
      payload as Parameters<typeof normalizeIcqqGuildInboundMessage>[0],
    );
    if (!normalized) {
      this.#logger.debug(formatCompact({
        op: 'icqq_inbound_skip',
        reason: 'guild_normalize_failed',
        endpoint: this.endpointName,
      }));
      return;
    }
    this.#guildCatalog.upsertFromInbound(normalized.raw);
    if (!this.#inboundDeduper.shouldProcess(`guild:${normalized.messageId}`)) {
      this.#logger.debug(formatCompact({
        op: 'icqq_inbound_skip',
        reason: 'dedupe',
        endpoint: this.endpointName,
        id: `guild:${normalized.messageId}`,
      }));
      return;
    }
    this.admit({
      id: normalized.messageId,
      conversation: icqqInboundConversation(String(this.#options.id), {
        channelType: 'channel',
        channelId: normalized.channelId,
        guildId: normalized.guildId,
      }),
      content: formatInboundContent(normalized.rawMessage),
      segments: normalized.content,
      sender: { id: normalized.userId, name: normalized.nickname || undefined },
      channelType: 'channel',
      metadata: {
        guildId: normalized.guildId,
        nickname: normalized.nickname,
      },
    });
  }

  #recordInboxRequest(payload: Record<string, unknown> | null): void {
    if (!payload || !isIcqqRequestPayload(payload)) return;
    const hooks = this.#options.inbox;
    if (!hooks) return;
    const row = buildIcqqInboxRequestRow(payload, this.#inboxBase());
    if (!row) return;
    if (!this.#inboxDeduper.shouldProcess(`request:${String(row.platform_request_id)}`)) return;
    void hooks.recordRequest(row);
    hooks.publish?.('endpoint:request', row);
  }

  #recordInboxNotice(payload: Record<string, unknown> | null): void {
    if (!payload || !isIcqqNoticePayload(payload)) return;
    const hooks = this.#options.inbox;
    if (!hooks) return;
    const row = buildIcqqInboxNoticeRow(payload, this.#inboxBase());
    if (!row) return;
    if (!this.#inboxDeduper.shouldProcess(`notice:${String(row.platform_notice_id)}`)) return;
    void hooks.recordNotice(row);
    hooks.publish?.('endpoint:notice', row);
  }

  #inboxBase(): { adapter: string; endpointKey: string } {
    const id = String(this.#options.id);
    return { adapter: id.split('\0').pop() ?? id, endpointKey: this.endpointName };
  }

  async #pullPendingSystemMessages(): Promise<void> {
    const hooks = this.#options.inbox;
    if (!hooks) return;
    try {
      const messages = await this.getSystemMsg();
      const friendRequests: IcqqSystemMessage[] = [];
      const groupRequests: IcqqSystemMessage[] = [];
      for (const msg of messages) {
        if ((msg as { request_type?: string }).request_type === 'friend') {
          friendRequests.push(msg as unknown as IcqqSystemMessage);
        } else {
          groupRequests.push(msg as unknown as IcqqSystemMessage);
        }
      }
      const base = this.#inboxBase();
      const rows = [
        ...friendRequests.map((m) => buildIcqqSystemRequestRow(m, 'friend', base)),
        ...groupRequests.map((m) => buildIcqqSystemRequestRow(m, 'group', base)),
      ];
      for (const row of rows) {
        if (!row) continue;
        if (!this.#inboxDeduper.shouldProcess(`request:${String(row.platform_request_id)}`)) continue;
        void hooks.recordRequest(row);
        hooks.publish?.('endpoint:request', row);
      }
    } catch (error) {
      this.#logger.debug(formatCompact({
        op: 'inbox_pull_system_msg',
        endpoint: this.endpointName,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  async #approveRequest(id: string, remark?: string): Promise<void> {
    const messages = await this.getSystemMsg();
    const target = messages.find((m) => {
      const msg = m as unknown as IcqqSystemMessage;
      return msg.flag === id || (msg.seq != null && String(msg.seq) === id);
    }) as unknown as IcqqSystemMessage | undefined;
    if (!target?.flag) {
      throw new Error(`icqq 未找到待处理请求: ${id}`);
    }
    if ((target as { request_type?: string }).request_type === 'friend') {
      await this.setFriendAddRequest(target.flag, true, remark);
    } else {
      await this.setGroupAddRequest(target.flag, true);
    }
  }

  async #rejectRequest(id: string, reason?: string): Promise<void> {
    const messages = await this.getSystemMsg();
    const target = messages.find((m) => {
      const msg = m as unknown as IcqqSystemMessage;
      return msg.flag === id || (msg.seq != null && String(msg.seq) === id);
    }) as unknown as IcqqSystemMessage | undefined;
    if (!target?.flag) {
      throw new Error(`icqq 未找到待处理请求: ${id}`);
    }
    if ((target as { request_type?: string }).request_type === 'friend') {
      await this.setFriendAddRequest(target.flag, false);
    } else {
      await this.setGroupAddRequest(target.flag, false, reason);
    }
  }
}

function describeUnknownError(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message;
  if (error && typeof error === 'object') {
    try {
      return JSON.stringify(error);
    } catch {
      return inspect(error, { depth: 4, breakLength: 120 });
    }
  }
  return String(error);
}

function resolveIcqqGroupReactionTarget(
  message: MessageRef,
): { groupId: number; seq: number } | null {
  if (message.conversation.kind !== 'group') return null;
  const groupId = Number(message.conversation.id);
  if (!Number.isFinite(groupId) || groupId <= 0) return null;
  const raw = message.id?.trim();
  if (!raw || raw.startsWith('outbound:')) return null;
  if (/^[1-9]\d*$/.test(raw)) return { groupId, seq: Number(raw) };
  try {
    const parsed = parseGroupMessageId(raw);
    if (parsed.seq > 0) return { groupId: parsed.group_id || groupId, seq: parsed.seq };
  } catch {
    // not a cqhttp group message id
  }
  return null;
}

function resolveNativeClientConfig(config: ResolvedIcqqConfig): NativeIcqqClientConfig {
  return {
    log_level: 'info',
    platform: config.platform,
    ...(config.ver ? { ver: config.ver } : {}),
    ...(config.dataDir ? { data_dir: config.dataDir } : {}),
    ...(config.signApiAddr ? { sign_api_addr: config.signApiAddr } : {}),
    ...(config.ignoreSelf != null ? { ignore_self: config.ignoreSelf } : {}),
    ...(config.resend != null ? { resend: config.resend } : {}),
    ...(config.cacheGroupMember != null ? { cache_group_member: config.cacheGroupMember } : {}),
    ...(config.autoServer != null ? { auto_server: config.autoServer } : {}),
    ...(config.qqnt != null ? { QQNT: config.qqnt } : {}),
    ...(config.ntLogin != null ? { NTLogin: config.ntLogin } : {}),
    reconn_interval: config.autoReconnect ? 5 : 0,
  };
}

function buildIcqqQuoteMetadata(
  data: IcqqMessageEvent,
  base: Record<string, unknown>,
): Record<string, unknown> {
  const metadata: Record<string, unknown> = { ...base };
  const quoteId = resolveIcqqQuoteIdFromEvent(data);
  if (quoteId) metadata.quote_id = quoteId;
  const quoted = quotedPayloadFromIcqqSource(findIcqqNestedMessageSource(data));
  if (quoted?.sender?.id) metadata.quote_sender_id = quoted.sender.id;
  if (quoted?.sender?.name) metadata.quote_sender_name = quoted.sender.name;
  const quoteText = quoted
    ? (typeof quoted.content === 'string'
        ? quoted.content
        : quoted.content
            .map((seg) =>
              seg && typeof seg === 'object' && seg.type === 'text'
                ? String((seg.data as { text?: unknown } | undefined)?.text ?? '')
                : '',
            )
            .join('')
      ).trim() || quoted.raw || ''
    : '';
  if (quoteText) metadata.quote_content = quoteText;
  return metadata;
}

const INBOUND_HOLD_LIMIT = 32;

const ICQQ_SERIALIZE_SKIP = ['group', 'member', 'friend', 'discuss', 'client'] as const;

function serializeIcqqEvent(event: unknown): Record<string, unknown> | null {
  if (!event || typeof event !== 'object') return null;
  const nativeToJSON = (event as { toJSON?: (keys: string[]) => unknown }).toJSON;
  if (typeof nativeToJSON === 'function') {
    try {
      const json = nativeToJSON.call(event, [...ICQQ_SERIALIZE_SKIP]);
      if (json && typeof json === 'object' && !Array.isArray(json)) {
        return json as Record<string, unknown>;
      }
    } catch {
      /* JSON.stringify 也会无参调 toJSON，不能当回退 */
    }
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(event as Record<string, unknown>)) {
    if (typeof value === 'function' || (ICQQ_SERIALIZE_SKIP as readonly string[]).includes(key)) continue;
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}
