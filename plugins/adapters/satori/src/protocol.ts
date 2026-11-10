import type { EndpointProfileConfiguration } from 'zhin.js/adapter';
/** Satori protocol helpers. Spec: https://satori.chat/zh-CN/protocol/overview.html */

import { AsyncLocalStorage } from 'node:async_hooks';
import { buildNotice, composeSideEventName, senderFromId, type IncomingNotice } from '@zhin.js/core';
import { EndpointDeliveryError, isMediaRef, type ConversationKind, type ConversationRef, type Segment } from '@zhin.js/im-contract';
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
 * Satori Emoji。字段对齐文档 https://satori.chat/zh-CN/resources/emoji.html （`id`、`name?`）。
 * `@imhelper/satori-v1` 1.0.7 / 1.0.10 没有这个类型。上游 `feat/satori-1.3-alignment`
 * 会补上，但这次不发布 npm，适配器先用本地声明。上游发版后可以换成 SDK 导出的官方类型。
 */
export interface SatoriEmoji {
  readonly id: string;
  readonly name?: string;
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
  readonly member?: { readonly user?: SatoriUser; readonly nick?: string; readonly roles?: string[] };
  readonly operator?: SatoriUser;
  /**
   * 事件表情。本地字段，原因见 {@link SatoriEmoji}。
   * @see https://satori.chat/zh-CN/protocol/events.html
   */
  readonly emoji?: SatoriEmoji;
  /**
   * 被动请求的来源上下文。协议不约束内部结构，发送时必须原样回传。
   * 资源页 `message.create` 表格目前没列出该字段，但被动请求页要求传入，
   * 协议方法表也包含 `referrer`。这里以被动请求页为准。
   * 本地字段：`SatoriV1Event` 尚未声明它。上游发版后可以换成官方类型。
   * @see https://satori.chat/zh-CN/advanced/passive.html
   */
  readonly referrer?: unknown;
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
 * 入站元素解码。`content` 仍保留协议原文，结构化元素另外放进 segments。
 * 只识别标准元素 at / img / emoji / audio / video / file。
 * @see https://satori.chat/zh-CN/protocol/elements.html
 */
export function decodeSatoriContent(content: string): Segment[] {
  const segments: Segment[] = [];
  let text = '';
  const flush = () => {
    if (!text) return;
    segments.push({ type: 'text', data: { text: unescapeXml(text) } });
    text = '';
  };
  for (let index = 0; index < content.length;) {
    if (content[index] !== '<') {
      text += content[index];
      index += 1;
      continue;
    }
    const parsed = readSatoriElement(content, index);
    if (!parsed || !DECODABLE_SATORI_TAGS.has(parsed.name)) {
      text += content[index];
      index += 1;
      continue;
    }
    flush();
    segments.push(segmentFromSatoriElement(parsed.name, parsed.attrs));
    if (parsed.inner) segments.push(...decodeSatoriContent(parsed.inner));
    index = parsed.end;
  }
  flush();
  return segments;
}

/** 仅在出现非文本元素时把解码结果送进消息管道，纯文本保持原来的 content-only 形状。 */
export function inboundSatoriSegments(content: string): readonly Segment[] | undefined {
  const segments = decodeSatoriContent(content);
  return segments.some(segment => segment.type !== 'text') ? segments : undefined;
}

const GUILD_EMOJI_NOTICE: Readonly<Record<string, string>> = {
  'guild-emoji-added': 'emoji_added',
  'guild-emoji-updated': 'emoji_updated',
  'guild-emoji-deleted': 'emoji_deleted',
};

/**
 * `guild-emoji-*` → `notice.group.emoji_*`。
 * 文档只要求资源 `emoji`，没有可回复频道，因此不填 conversation。
 * 上游 SDK 目前只把这些事件原样 emit("event")，映射放在适配器内。
 * @see https://satori.chat/zh-CN/resources/emoji.html
 */
export function mapGuildEmojiNotice(body: SatoriEventBody, endpointId: string): IncomingNotice | undefined {
  const subType = body.type ? GUILD_EMOJI_NOTICE[body.type] : undefined;
  if (!subType) return undefined;
  const emoji = normalizeSatoriEmoji(body.emoji);
  if (!emoji) return undefined;
  const label = noticeLabel(emoji.name ?? emoji.id);
  return buildNotice(body, {
    id: ['satori', body.type, body.guild?.id ?? '', emoji.id, String(body.sn ?? body.timestamp ?? 0)].join(':'),
    clientAdapter: 'satori',
    endpointId,
    type: 'notice',
    name: composeSideEventName('notice', 'group', subType),
    ...(body.operator?.id ? { actor: senderFromId(body.operator.id, body.operator.name) } : {}),
    timestamp: typeof body.timestamp === 'number' ? body.timestamp : Date.now(),
    ...(label ? { value: label } : {}),
  });
}

/**
 * 被动回复的 referrer 只活在这次事件的异步调用链里。
 * 不把「最近一次 referrer」存成端点字段，避免之后的主动消息带上过期来源。
 * @see https://satori.chat/zh-CN/advanced/passive.html
 */
const satoriReferrer = new AsyncLocalStorage<unknown>();

export function withSatoriReferrer<T>(referrer: unknown, run: () => T): T {
  return satoriReferrer.run(referrer, run);
}

/** `message.create` 参数。有来源上下文时原样附带，不挑字段、不改名。 */
export function satoriMessageCreateParams(channelId: string, content: string): Record<string, unknown> {
  const referrer = satoriReferrer.getStore();
  return {
    channel_id: channelId,
    content,
    ...(referrer !== undefined ? { referrer } : {}),
  };
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
 * 把已渲染的出站载荷编成 Satori 消息字符串。
 * at / mention → `<at>`，image → `<img>`，其余媒体用同名标准元素，emoji → `<emoji>`。
 * 整段字符串原样发送（调用方可能已经写好标记）；段数组里的文本会转义。
 * 上游 message-codec 把段编成 `{type, attrs}` 对象，而且不会把 mention/image 改成 at/img。
 * 这里在适配器内按文档元素编码。上游发版后如果 SDK 直接产出这些元素，可以改走 SDK。
 * @see https://satori.chat/zh-CN/protocol/elements.html
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
      parts.push(escapeXmlText(item));
      continue;
    }
    const data = item.data ?? {};
    switch (item.type) {
      case 'text':
        parts.push(escapeXmlText(String(data.text ?? data.content ?? '')));
        break;
      case 'at':
      case 'mention':
        parts.push(encodeAtElement(data));
        break;
      case 'emoji':
        parts.push(encodeEmojiElement(data));
        break;
      case 'image':
      case 'audio':
      case 'video':
      case 'file': {
        const src = resolveMediaSrc(item.type, data);
        if (src) parts.push(encodeMediaElement(item.type, src, data));
        break;
      }
      default:
        break;
    }
  }
  return parts.join('');
}

const MEDIA_ELEMENT_NAMES = {
  image: 'img',
  audio: 'audio',
  video: 'video',
  file: 'file',
} as const;

const DECODABLE_SATORI_TAGS = new Set(['at', 'img', 'emoji', 'audio', 'video', 'file']);

function encodeAtElement(data: Record<string, unknown>): string {
  const explicitType = readString(data.type);
  const rawId = readString(data.id) ?? readString(data.target);
  const id = rawId === 'all' || rawId === 'here' ? undefined : rawId;
  const type = explicitType ?? (rawId === 'all' || rawId === 'here' ? rawId : undefined);
  return renderSatoriElement('at', [
    ['id', id],
    ['name', readString(data.name)],
    ['role', readString(data.role)],
    ['type', type],
  ]);
}

function encodeEmojiElement(data: Record<string, unknown>): string {
  return renderSatoriElement('emoji', [
    ['id', readString(data.id) ?? readString(data.emoji)],
    ['name', readString(data.name)],
  ]);
}

function encodeMediaElement(
  type: keyof typeof MEDIA_ELEMENT_NAMES,
  src: string,
  data: Record<string, unknown>,
): string {
  const title = readString(data.title) ?? readString(data.name);
  const fileName = isMediaRef(data.media) ? data.media.file_name : undefined;
  const duration = typeof data.duration === 'number' ? String(data.duration) : undefined;
  const poster = readString(data.poster);
  const timed = type === 'audio' || type === 'video';
  return renderSatoriElement(MEDIA_ELEMENT_NAMES[type], [
    ['src', src],
    ['title', title ?? fileName],
    ['duration', timed ? duration : undefined],
    ['poster', timed || type === 'file' ? poster : undefined],
  ]);
}

function renderSatoriElement(
  name: string,
  attrs: ReadonlyArray<readonly [string, string | undefined]>,
): string {
  const rendered = attrs
    .filter((entry): entry is readonly [string, string] => typeof entry[1] === 'string' && entry[1] !== '')
    .map(([key, value]) => ` ${key}="${escapeXmlAttr(value)}"`)
    .join('');
  return `<${name}${rendered}/>`;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function escapeXmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeXmlAttr(value: string): string {
  return escapeXmlText(value).replace(/"/g, '&quot;');
}

function unescapeXml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

interface SatoriParsedElement {
  readonly name: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly inner?: string;
  readonly end: number;
}

function readSatoriElement(content: string, start: number): SatoriParsedElement | undefined {
  const next = content[start + 1];
  if (next === '/' || next === '!' || next === '?') return undefined;
  const head = /^<([A-Za-z][\w:-]*)([^>]*)>/u.exec(content.slice(start));
  if (!head?.[1]) return undefined;
  const name = head[1].toLowerCase();
  const rawAttrs = head[2] ?? '';
  const selfClosing = /\/\s*$/u.test(rawAttrs);
  const attrs = parseXmlAttributes(selfClosing ? rawAttrs.replace(/\/\s*$/u, '') : rawAttrs);
  let end = start + head[0].length;
  if (selfClosing) return { name, attrs, end };
  const close = new RegExp(`</${name}\\s*>`, 'iu').exec(content.slice(end));
  if (!close) return { name, attrs, end };
  const inner = content.slice(end, end + close.index);
  end += close.index + close[0].length;
  return { name, attrs, ...(inner ? { inner } : {}), end };
}

function parseXmlAttributes(source: string): Readonly<Record<string, string>> {
  const attrs: Record<string, string> = {};
  for (const match of source.matchAll(/([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/gu)) {
    const key = match[1]?.toLowerCase();
    if (!key) continue;
    attrs[key] = unescapeXml(match[2] ?? match[3] ?? '');
  }
  return attrs;
}

function segmentFromSatoriElement(name: string, attrs: Readonly<Record<string, string>>): Segment {
  if (name === 'at') {
    const type = attrs.type;
    const target = attrs.id || (type === 'all' || type === 'here' ? type : undefined);
    return {
      type: 'mention',
      data: {
        ...(target ? { target } : {}),
        ...(attrs.name ? { name: attrs.name } : {}),
        ...(attrs.role ? { role: attrs.role } : {}),
        ...(type ? { type } : {}),
      },
    };
  }
  if (name === 'emoji') {
    return {
      type: 'emoji',
      data: {
        ...(attrs.id ? { id: attrs.id } : {}),
        ...(attrs.name ? { name: attrs.name } : {}),
      },
    };
  }
  const type = name === 'img' ? 'image' : name;
  const src = attrs.src ?? '';
  const base64 = src.startsWith('base64://');
  return {
    type,
    data: {
      media: base64
        ? { kind: 'base64', value: src.slice('base64://'.length) }
        : { kind: 'url', value: src },
      ...(attrs.title ? { name: attrs.title } : {}),
      ...(attrs.duration && Number.isFinite(Number(attrs.duration)) ? { duration: Number(attrs.duration) } : {}),
    },
  };
}

function normalizeSatoriEmoji(value: unknown): SatoriEmoji | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as { id?: unknown; name?: unknown };
  if (typeof record.id !== 'string' || !record.id) return undefined;
  return {
    id: record.id,
    ...(typeof record.name === 'string' ? { name: record.name } : {}),
  };
}

function noticeLabel(value: string): string | undefined {
  const flat = value.replace(/\s+/g, ' ').trim();
  if (!flat) return undefined;
  return flat.length > 40 ? `${flat.slice(0, 39)}…` : flat;
}

export function extractCreatedMessageId(result: unknown): string {
  const list = Array.isArray(result)
    ? result
    : (result as { data?: unknown[] } | null)?.data;
  const msg = list?.[0] as { id?: string } | undefined;
  return msg?.id ?? '';
}
