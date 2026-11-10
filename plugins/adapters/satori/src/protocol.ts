import type { EndpointProfileConfiguration } from 'zhin.js/adapter';
/** Satori protocol helpers. Spec: https://satori.chat/zh-CN/protocol/overview.html */

import { buildRequest, senderFromId, sideEventConversation, type IncomingRequest } from '@zhin.js/core';
import { EndpointDeliveryError, isMediaRef, type ConversationKind, type ConversationRef } from '@zhin.js/im-contract';
import { formatCompact, getLogger } from '@zhin.js/logger';

const logger = getLogger('satori');

/** Opcode：EVENT=0, PING=1, PONG=2, IDENTIFY=3, READY=4, META=5 */
export const SatoriOpcode = {
  EVENT: 0,
  PING: 1,
  PONG: 2,
  IDENTIFY: 3,
  READY: 4,
  META: 5,
} as const;

export interface SatoriSignal {
  readonly op: number;
  readonly body?: Record<string, unknown>;
}

export interface SatoriUser {
  readonly id: string;
  readonly name?: string;
  readonly avatar?: string;
}

/**
 * 群组角色。文档只声明 `id` 和 `name?`。
 * 协议源码里还有 color、position 等字段，这里以文档为准，不建模它们。
 * `@imhelper/satori-v1` 没有这个类型。上游 `feat/satori-1.3-alignment` 会补，但未发 npm。
 * 上游发版后可以换成官方类型。
 * @see https://satori.chat/zh-CN/resources/role.html
 */
export interface SatoriGuildRole {
  readonly id: string;
  readonly name?: string;
}

/**
 * 好友。文档形状是 `{ user?, nick? }`，不是带顶层 `id` / `name` / `avatar` 的 User。
 * 1.0.10 的 `directory-api.getFriendList` 仍按 User 读取 `friend.id`。本地按文档解析。
 * 上游发版后可以换成官方类型。
 * @see https://satori.chat/zh-CN/resources/friend.html
 */
export interface SatoriFriend {
  readonly user?: SatoriUser;
  readonly nick?: string;
}

/**
 * 群组成员。`roles` 在 1.3 起是 `GuildRole[]`，不再是 `string[]`。
 * 本地类型。上游发版后可以换成官方类型。
 * @see https://satori.chat/zh-CN/resources/member.html
 */
export interface SatoriGuildMember {
  readonly user?: SatoriUser;
  readonly nick?: string;
  readonly avatar?: string;
  readonly joined_at?: number;
  readonly roles?: readonly SatoriGuildRole[];
}

export interface SatoriChannel {
  readonly id: string;
  /** 0=TEXT, 1=DIRECT, 2=CATEGORY, 3=VOICE */
  readonly type?: number;
  readonly name?: string;
  readonly parent_id?: string;
}

export interface SatoriMessage {
  readonly id: string;
  readonly content?: string;
  readonly channel?: SatoriChannel;
  readonly user?: SatoriUser;
  readonly member?: { readonly user?: SatoriUser; readonly nick?: string };
  readonly created_at?: number;
  readonly updated_at?: number;
}

export interface SatoriLogin {
  readonly platform?: string;
  readonly user?: SatoriUser;
  readonly status?: number;
  readonly sn?: number;
}

export interface SatoriEventBody {
  readonly type?: string;
  readonly sn?: number;
  readonly timestamp?: number;
  readonly login?: SatoriLogin;
  readonly message?: SatoriMessage;
  readonly channel?: SatoriChannel;
  readonly user?: SatoriUser;
  readonly guild?: { readonly id: string; readonly name?: string };
  readonly member?: SatoriGuildMember;
  /**
   * 事件里的好友。本地字段，原因见 {@link SatoriFriend}。
   * @see https://satori.chat/zh-CN/protocol/events.html
   */
  readonly friend?: SatoriFriend;
  readonly [key: string]: unknown;
}

export interface SatoriApiOptions {
  readonly baseUrl: string;
  readonly platform: string;
  readonly userId: string;
  readonly token?: string;
  readonly signal?: AbortSignal;
}

export interface SatoriWireSegment {
  readonly type: string;
  readonly data?: Record<string, unknown>;
}

/** One endpoint config after AdapterIndex expands `plugins.<instanceKey>.endpoints`. */
export interface SatoriEndpointConfig extends EndpointProfileConfiguration {
  readonly id: string;
  /** Exact remote login selected by this configured Endpoint. */
  readonly platform: string;
  readonly userId: string;
  readonly connection?: 'ws' | 'webhook';
  readonly baseUrl: string;
  readonly token?: string;
  readonly heartbeat_interval?: number;
  /** Webhook POST path (connection: webhook). */
  readonly path?: string;
}

export interface ResolvedSatoriWsConfig {
  readonly context: 'satori';
  readonly connection: 'ws';
  readonly id: string;
  readonly platform: string;
  readonly userId: string;
  readonly baseUrl: string;
  readonly token?: string;
  readonly heartbeat_interval: number;
}

export interface ResolvedSatoriWebhookConfig {
  readonly context: 'satori';
  readonly connection: 'webhook';
  readonly id: string;
  readonly platform: string;
  readonly userId: string;
  readonly baseUrl: string;
  readonly token?: string;
  readonly path: string;
}

export type ResolvedSatoriConfig = ResolvedSatoriWsConfig | ResolvedSatoriWebhookConfig;

export function resolveSatoriConfig(config: SatoriEndpointConfig): ResolvedSatoriConfig {
  const connection = config.connection ?? 'ws';
  const id = requiredEndpointField(config.id, 'id');
  const platform = requiredEndpointField(config.platform, 'platform');
  const userId = requiredEndpointField(config.userId, 'userId');
  const baseUrl = requiredEndpointField(config.baseUrl, 'baseUrl');
  const token = typeof config.token === 'string' && config.token.trim()
    ? config.token.trim()
    : undefined;

  if (connection === 'webhook') {
    const path = requiredEndpointField(config.path, 'path');
    return {
      context: 'satori',
      connection: 'webhook',
      id,
      platform,
      userId,
      baseUrl,
      token,
      path,
    };
  }

  const heartbeat = config.heartbeat_interval ?? 10_000;
  return {
    context: 'satori',
    connection: 'ws',
    id,
    platform,
    userId,
    baseUrl,
    token,
    heartbeat_interval: heartbeat,
  };
}

function requiredEndpointField(
  value: unknown,
  field: 'id' | 'baseUrl' | 'path' | 'platform' | 'userId',
): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`Satori endpoint requires a non-empty ${field}`);
  }
  return value.trim();
}

/** Channel.type 1 = DIRECT (private). */
export function isPrivateChannel(channel?: SatoriChannel): boolean {
  return channel?.type === 1;
}

export function isMessageEvent(
  body: SatoriEventBody,
): body is SatoriEventBody & { message: SatoriMessage } {
  return (body.type === 'message-created' || body.type === 'message-updated')
    && !!body.message?.id;
}

export function buildWsUrl(baseUrl: string, token?: string): string {
  const url = new URL(baseUrl.replace(/\/$/, ''));
  if (token) url.searchParams.set('access_token', token);
  return url.toString();
}

/**
 * Call Satori HTTP API: POST {baseUrl}/v1/{resource}.{method}
 * @see https://satori.chat/en-US/protocol/api.html
 */
export interface SatoriApiRequest extends SatoriApiOptions {
  readonly resource: string;
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

export async function callSatoriApi<T = unknown>(
  { resource, method, params = {}, ...options }: SatoriApiRequest,
): Promise<T> {
  const { baseUrl, platform, userId, token } = options;
  const url = `${baseUrl.replace(/\/$/, '')}/v1/${resource}.${method}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Satori-Platform': platform,
    'Satori-User-ID': userId,
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  if (options.signal?.aborted) throw new EndpointDeliveryError('endpoint_inactive', 'Satori request ended before submission', 'not_sent', { cause: options.signal.reason });
  const body = JSON.stringify(params);
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers, body, signal: options.signal });
  } catch (cause) {
    throw new EndpointDeliveryError('delivery_unconfirmed', 'Satori HTTP request outcome is unknown', 'unknown', { cause });
  }

  const text = await res.text();
  if (res.status === 401) throw new Error(`Satori API 认证失败: ${text}`);
  if (res.status === 403) throw new Error(`Satori API 权限不足: ${text}`);
  if (res.status === 404) throw new Error(`Satori API 不存在: ${resource}.${method}`);
  if (res.status >= 400) throw new Error(`Satori API 错误 ${res.status}: ${text}`);

  if (!text || text.trim() === '') return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Satori API 无效 JSON: ${text.slice(0, 200)}`);
  }
}

/** Build inbound text for OutboundMessageService.receive. */
export function formatInboundContent(body: SatoriEventBody & { message: SatoriMessage }): string {
  const content = body.message.content ?? '';
  return typeof content === 'string' ? content : String(content);
}


/**
 * 入站归一化 → ConversationRef：Channel.type 1 (DIRECT) → kind 'private'；
 * 其余频道消息 → kind 'group'，所属 guild 容器进 `parent`（kind 'channel'）。
 */
export function satoriInboundConversation(
  endpointKey: string,
  body: SatoriEventBody & { message: SatoriMessage },
): ConversationRef {
  const channel = body.channel ?? body.message.channel;
  const kind: ConversationKind = isPrivateChannel(channel) ? 'private' : 'group';
  return {
    endpoint: { id: endpointKey, adapter: endpointKey.split('\0')[0] ?? endpointKey },
    kind,
    id: channel?.id ?? '',
    ...(kind === 'group' && body.guild?.id
      ? { parent: { kind: 'channel' as const, id: body.guild.id } }
      : {}),
  };
}

export function resolveInboundSender(
  body: SatoriEventBody & { message: SatoriMessage },
): { id: string; name?: string } {
  const user = body.user ?? body.message.user ?? body.message.member?.user;
  const name = user?.name ?? body.message.member?.nick;
  const id = user?.id ?? name ?? '';
  return name && name !== id ? { id, name } : { id };
}

/**
 * Detect `<at id="…"/>` elements in message content targeting the bot selfId.
 * selfId 来源：READY/事件携带的 `login.user.id`。
 */
export function isSelfMentioned(
  body: SatoriEventBody & { message: SatoriMessage },
  selfId?: string,
): boolean {
  if (!selfId) return false;
  const content = body.message.content;
  if (typeof content !== 'string' || !content.includes('<at')) return false;
  const tags = content.match(/<at\b[^>]*>/gi) ?? [];
  return tags.some((tag) => /\bid\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] === selfId);
}

export function formatMessageId(channelId: string, messageId: string): string {
  return `${channelId}:${messageId}`;
}

export function parseMessageRef(id: string): { channelId: string; messageId: string } {
  if (id.includes(':')) {
    const [channelId, messageId] = id.split(':');
    return { channelId: channelId ?? '', messageId: messageId ?? '' };
  }
  return { channelId: '', messageId: id };
}

/**
 * 解析媒体段（image/audio/video/file）的投递源，canonical MediaRef 为唯一来源：
 * - kind=url → 直发 URL；
 * - kind=base64 → 规范为 `base64://` 前缀内联（Satori img/file 元素消费内联数据）。
 * 无 canonical 媒体引用或来源不可投递（path / file 本端点不物化）时 warn + 丢弃。
 */
function resolveMediaSrc(type: string, data: Record<string, unknown>): string | undefined {
  const media = data.media;
  if (!isMediaRef(media)) {
    logger.warn(formatCompact({
      op: 'satori_outbound_media_dropped',
      type,
      reason: 'missing_media_ref',
    }));
    return undefined;
  }
  if (media.kind === 'url') return media.value;
  if (media.kind === 'base64') {
    return media.value.startsWith('base64://') ? media.value : `base64://${media.value}`;
  }
  logger.warn(formatCompact({
    op: 'satori_outbound_media_dropped',
    type,
    reason: `unsupported_media_kind:${media.kind}`,
  }));
  return undefined;
}

/**
 * Wire-encode an already-rendered outbound payload into Satori message content.
 * Segment canonicalization is intentionally not done here.
 */
export function formatSatoriOutbound(payload: unknown): string {
  if (typeof payload === 'string') return payload;
  if (payload == null) return '';

  const segments: Array<string | SatoriWireSegment> = Array.isArray(payload)
    ? payload as Array<string | SatoriWireSegment>
    : payload && typeof payload === 'object' && 'type' in (payload as object)
      ? [payload as SatoriWireSegment]
      : [];

  if (segments.length === 0) {
    return typeof payload === 'object' ? JSON.stringify(payload) : String(payload);
  }

  const parts: string[] = [];
  for (const item of segments) {
    if (typeof item === 'string') {
      parts.push(item);
      continue;
    }
    const data = item.data ?? {};
    switch (item.type) {
      case 'text':
        parts.push(String(data.text ?? data.content ?? ''));
        break;
      case 'at':
      case 'mention':
        parts.push(`@${String(data.name ?? data.id ?? data.target ?? '')}`);
        break;
      case 'image':
      case 'audio':
      case 'video':
      case 'file': {
        const src = resolveMediaSrc(item.type, data);
        if (src) parts.push(`[${item.type}:${src}]`);
        break;
      }
      default:
        break;
    }
  }
  return parts.join('');
}

export function extractCreatedMessageId(result: unknown): string {
  const list = Array.isArray(result)
    ? result
    : (result as { data?: unknown[] } | null)?.data;
  const msg = list?.[0] as { id?: string } | undefined;
  return msg?.id ?? '';
}

/**
 * 把 `guild-member.list` 的 `roles` 收成 `GuildRole[]`。
 * 旧 SDK 可能仍下发 `string[]`，这里收成 `{ id }`。上游发版并保证对象数组后，字符串分支可以去掉。
 */
export function normalizeSatoriGuildRoles(value: unknown): readonly SatoriGuildRole[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const roles: SatoriGuildRole[] = [];
  for (const role of value) {
    if (typeof role === 'string' && role) {
      roles.push({ id: role });
      continue;
    }
    if (!role || typeof role !== 'object') continue;
    const record = role as { id?: unknown; name?: unknown };
    if (typeof record.id !== 'string' || !record.id) continue;
    roles.push({
      id: record.id,
      ...(typeof record.name === 'string' ? { name: record.name } : {}),
    });
  }
  return roles;
}

/** 成员列表原样保留其余字段，只把 roles 收成 GuildRole[]。 */
export function withSatoriGuildRoles<T>(member: T): T {
  if (!member || typeof member !== 'object' || !('roles' in member)) return member;
  const roles = normalizeSatoriGuildRoles((member as { roles?: unknown }).roles);
  if (!roles) return member;
  return { ...member, roles };
}

/**
 * 按 `{ user, nick }` 读取好友。顶层 `id` / `name` 是 1.0.10 误用的 User 形状，这里不认。
 */
export function readSatoriFriend(value: unknown): SatoriFriend | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as { user?: unknown; nick?: unknown };
  if (!record.user || typeof record.user !== 'object') return undefined;
  const user = record.user as { id?: unknown; name?: unknown; avatar?: unknown };
  if (typeof user.id !== 'string' || !user.id) return undefined;
  return {
    user: {
      id: user.id,
      ...(typeof user.name === 'string' ? { name: user.name } : {}),
      ...(typeof user.avatar === 'string' ? { avatar: user.avatar } : {}),
    },
    ...(typeof record.nick === 'string' ? { nick: record.nick } : {}),
  };
}

export type SatoriReactionMethod = 'create' | 'delete' | 'clear' | 'list';

/**
 * reaction.* 的参数名是 `emoji_id`，不是 1.0.10 `addMessageReactionIn` 用的 `emoji`。
 * clear 不传 emoji_id 表示清除全部表态。
 * @see https://satori.chat/zh-CN/resources/reaction.html
 */
export function satoriReactionParams(
  method: SatoriReactionMethod,
  input: {
    readonly channelId: string;
    readonly messageId: string;
    readonly emojiId?: string;
    readonly userId?: string;
    readonly next?: string;
  },
): Record<string, unknown> {
  const params: Record<string, unknown> = {
    channel_id: input.channelId,
    message_id: input.messageId,
  };
  if (input.emojiId !== undefined && (method !== 'clear' || input.emojiId !== '')) {
    params.emoji_id = input.emojiId;
  }
  if (method === 'delete' && input.userId !== undefined) params.user_id = input.userId;
  if (method === 'list' && input.next !== undefined) params.next = input.next;
  return params;
}

/** `friend.approve` 同时表达通过和拒绝。 */
export function satoriFriendApproveParams(
  messageId: string,
  approve: boolean,
  comment?: string,
): Record<string, unknown> {
  return {
    message_id: messageId,
    approve,
    ...(comment !== undefined ? { comment } : {}),
  };
}

export interface SatoriFriendRequestActions {
  approve(messageId: string, comment?: string): Promise<void>;
  reject(messageId: string, reason?: string): Promise<void>;
}

/**
 * `friend-request` → `request.friend.add`，让它进入 request.receive 管道。
 * 文档的必需资源是 `user`。`friend.approve` 的请求 ID 是 `message_id`；
 * 事件没有 `message.id` 时仍然投递，但批准/拒绝会说明缺少该字段。
 * @see https://satori.chat/zh-CN/resources/friend.html
 */
export function mapSatoriFriendRequest(
  body: SatoriEventBody,
  endpointId: string,
  actions: SatoriFriendRequestActions,
): IncomingRequest | undefined {
  if (body.type !== 'friend-request') return undefined;
  const user = body.user ?? body.friend?.user;
  if (!user?.id) return undefined;
  const actor = senderFromId(user.id, user.name ?? body.friend?.nick);
  if (!actor) return undefined;
  const messageId = typeof body.message?.id === 'string' && body.message.id ? body.message.id : undefined;
  const requireMessageId = (kind: 'approve' | 'reject') => {
    if (!messageId) {
      throw new Error(`Satori friend.approve 需要事件 message.id 作为 message_id，无法${kind === 'approve' ? '通过' : '拒绝'}该好友申请`);
    }
    return messageId;
  };
  return buildRequest(body, {
    id: messageId ?? `satori:friend-request:${user.id}:${String(body.sn ?? body.timestamp ?? 0)}`,
    clientAdapter: 'satori',
    endpointId,
    type: 'request',
    name: 'request.friend.add',
    conversation: sideEventConversation('friend', user.id),
    actor,
    ...(typeof body.message?.content === 'string' ? { comment: body.message.content } : {}),
    timestamp: typeof body.timestamp === 'number' ? body.timestamp : Date.now(),
    async $approve(remark?: string) {
      await actions.approve(requireMessageId('approve'), remark);
    },
    async $reject(reason?: string) {
      await actions.reject(requireMessageId('reject'), reason);
    },
  });
}
