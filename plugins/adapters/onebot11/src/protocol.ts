/**
 * OneBot 11 protocol helpers (no legacy Adapter/Endpoint / segment-mapper).
 * Canonicalization is owned by gateway/core before endpoint.send.
 * Spec: https://github.com/botuniverse/onebot-11
 */
import { isMediaRef, type MediaRef } from '@zhin.js/core';
import type { ConversationRef } from '@zhin.js/im-contract';
import { formatCompact, getLogger } from '@zhin.js/logger';

const logger = getLogger('onebot11');

/** Transitional legacy endpoint row (`endpoints[]` with `context: onebot11`). */
export interface OneBot11LegacyEndpointRow {
  readonly context?: string;
  readonly connection?: 'ws' | 'wss';
  /** Legacy alias: `type: 'ws' | 'ws_reverse'` */
  readonly type?: string;
  readonly name?: string;
  readonly access_token?: string;
  readonly url?: string;
  readonly path?: string;
  readonly reconnect_interval?: number;
  readonly heartbeat_interval?: number;
}

/** Plugin Runtime owner config (`plugins.<instanceKey>` / schema.json). */
export interface OneBot11AdapterConfig {
  readonly connection?: 'ws' | 'wss';
  readonly name?: string;
  readonly access_token?: string;
  readonly url?: string;
  readonly path?: string;
  readonly reconnect_interval?: number;
  readonly heartbeat_interval?: number;
  /** Transitional: legacy root `endpoints[]` with `context: onebot11`. */
  readonly endpoints?: ReadonlyArray<OneBot11LegacyEndpointRow>;
}

export interface OneBot11ConfigBase {
  readonly context: 'onebot11';
  readonly name: string;
  readonly access_token?: string;
}

/** 正向 WebSocket：应用连 OneBot 实现的 WS 服务器 */
export interface OneBot11WsConfig extends OneBot11ConfigBase {
  readonly connection: 'ws';
  readonly url: string;
  readonly reconnect_interval: number;
  readonly heartbeat_interval: number;
}

/** 反向 WebSocket（slice 1 deferred — needs httpHostToken） */
export interface OneBot11WssConfig extends OneBot11ConfigBase {
  readonly connection: 'wss';
  readonly path: string;
  readonly heartbeat_interval: number;
}

export type ResolvedOneBot11Config = OneBot11WsConfig | OneBot11WssConfig;
export type OneBot11EndpointConfig = ResolvedOneBot11Config;

export interface OneBot11Sender {
  readonly role?: string;
  readonly nickname?: string;
  readonly card?: string;
  readonly title?: string;
}

export interface OneBot11Segment {
  type: string;
  data?: Record<string, unknown>;
}

export interface OneBot11Event {
  post_type: string;
  self_id?: number | string;
  message_type?: string;
  sub_type?: string;
  message_id?: number | string;
  user_id?: number | string;
  group_id?: number | string;
  sender?: OneBot11Sender;
  message?: OneBot11Segment[];
  raw_message?: string;
  time?: number;
  notice_type?: string;
  request_type?: string;
  [key: string]: unknown;
}

export interface OneBot11ActionRequest {
  action: string;
  params: Record<string, unknown>;
  echo?: string;
}

export interface OneBot11ActionResponse {
  status: string;
  retcode: number;
  data?: unknown;
  echo?: string;
}

export interface OneBot11WireSegment {
  readonly type: string;
  readonly data?: Record<string, unknown>;
}

function normalizeConnection(
  connection: string | undefined,
  legacyType: string | undefined,
): 'ws' | 'wss' {
  if (connection === 'ws' || connection === 'wss') return connection;
  if (legacyType === 'ws_reverse' || legacyType === 'wss') return 'wss';
  if (legacyType === 'ws') return 'ws';
  return 'ws';
}

export function resolveOneBot11Config(config: OneBot11AdapterConfig = {}): ResolvedOneBot11Config {
  const entry = config.endpoints?.find((item) => item.context === 'onebot11');
  const connection = normalizeConnection(
    config.connection ?? entry?.connection,
    entry?.type,
  );
  const name = (typeof config.name === 'string' && config.name)
    || (typeof entry?.name === 'string' && entry.name)
    || process.env.ONEBOT11_BOT_NAME
    || 'onebot11-bot';
  const access_token = config.access_token ?? entry?.access_token;

  if (connection === 'ws') {
    const url = config.url ?? entry?.url;
    if (!url) {
      throw new TypeError(
        'OneBot11 connection:ws requires url (plugins.<key>.url or endpoints with context: onebot11)',
      );
    }
    return {
      context: 'onebot11',
      connection: 'ws',
      name,
      access_token,
      url,
      reconnect_interval: config.reconnect_interval ?? entry?.reconnect_interval ?? 5000,
      heartbeat_interval: config.heartbeat_interval ?? entry?.heartbeat_interval ?? 30_000,
    };
  }

  if (connection === 'wss') {
    const path = config.path ?? entry?.path;
    if (!path) {
      throw new TypeError('OneBot11 connection:wss requires path');
    }
    return {
      context: 'onebot11',
      connection: 'wss',
      name,
      access_token,
      path,
      heartbeat_interval: config.heartbeat_interval ?? entry?.heartbeat_interval ?? 30_000,
    };
  }

  throw new TypeError(`Unknown OneBot11 connection: ${String(connection)}`);
}

/** 判断是否为消息事件（post_type=message） */
export function isMessageEvent(
  ev: OneBot11Event,
): ev is OneBot11Event & { message_id: number | string } {
  return ev.post_type === 'message' && ev.message_id != null;
}

/** 从事件得到场景 id：私聊 user_id，群 group_id */
export function getChannelId(ev: OneBot11Event): string {
  if (ev.message_type === 'group' && ev.group_id != null) return String(ev.group_id);
  if (ev.group_id != null && ev.message_type !== 'private') return String(ev.group_id);
  if (ev.user_id != null) return String(ev.user_id);
  return '';
}

/**
 * 入站归一化 → ConversationRef：OneBot 11 `group` 消息 → kind 'group'，
 * 其余（private 及带 group_id 的非 private 事件按群处理）→ kind 'private'。
 * OneBot 11 无 guild/temp 容器概念，不填 parent。
 */
export function onebot11InboundConversation(endpointId: string, ev: OneBot11Event): ConversationRef {
  const kind = ev.message_type === 'group' || (ev.group_id != null && ev.message_type !== 'private')
    ? 'group' as const
    : 'private' as const;
  return {
    endpoint: { id: endpointId, adapter: endpointId.split('\0')[0] ?? endpointId },
    kind,
    id: getChannelId(ev),
  };
}

/** Build inbound text for MessageGateway.receive */
export function formatInboundContent(ev: OneBot11Event): string {
  if (typeof ev.raw_message === 'string' && ev.raw_message) return ev.raw_message;
  if (Array.isArray(ev.message)) {
    return ev.message
      .map((seg) => (seg.type === 'text' ? String(seg.data?.text ?? '') : ''))
      .join('');
  }
  return '';
}

export function senderDisplayName(ev: OneBot11Event): string {
  const name = ev.sender?.card || ev.sender?.nickname;
  if (typeof name === 'string' && name) return name;
  return ev.user_id != null ? String(ev.user_id) : '';
}

/**
 * Runtime Message.sender 必须是用户 ID（agent bridge 用它与 endpointMaster 比对）。
 * user_id 缺失时兜底为空串，绝不回退到显示名。
 */
export function senderUserId(ev: OneBot11Event): string {
  return ev.user_id != null ? String(ev.user_id) : '';
}

/** 显示名（群名片优先）放 metadata.nickname；没有则返回 undefined，不写该字段。 */
export function senderNickname(ev: OneBot11Event): string | undefined {
  const name = ev.sender?.card || ev.sender?.nickname;
  return typeof name === 'string' && name ? name : undefined;
}

/**
 * 回复引用 id：优先取 message 数组中的 {type:'reply', data:{id}} 段；
 * 兼容部分实现把 reply 放在事件顶层（标量或带 message_id 的对象）。
 */
export function extractQuoteId(ev: OneBot11Event): string | undefined {
  if (Array.isArray(ev.message)) {
    for (const seg of ev.message) {
      if (seg?.type === 'reply' && seg.data?.id != null) return String(seg.data.id);
    }
  }
  const reply = ev.reply;
  if (typeof reply === 'number' || typeof reply === 'string') return String(reply);
  if (reply && typeof reply === 'object' && 'message_id' in reply) {
    const id = (reply as { message_id?: unknown }).message_id;
    if (id != null) return String(id);
  }
  return undefined;
}

/** 扫描 message 段中的 at，qq 等于本机 uin（self_id）即视为被 @；`qq:'all'`（@全体）不算。 */
export function isOneBot11BotMentioned(input: {
  readonly selfId: string | undefined;
  readonly message?: readonly OneBot11Segment[];
}): boolean {
  if (!input.selfId || !Array.isArray(input.message)) return false;
  return input.message.some((seg) => {
    if (seg?.type !== 'at' || seg.data?.qq == null) return false;
    const qq = String(seg.data.qq);
    return qq !== 'all' && qq === input.selfId;
  });
}

/** 构造 gateway.receive 的 metadata（ws / wss 两个 endpoint 共用）。 */
export function formatInboundMetadata(
  ev: OneBot11Event,
  endpoint: string,
): Readonly<Record<string, unknown>> {
  const selfId = ev.self_id != null ? String(ev.self_id) : undefined;
  const nickname = senderNickname(ev);
  const quoteId = extractQuoteId(ev);
  const mentioned = isOneBot11BotMentioned({ selfId, message: ev.message });
  return Object.freeze({
    message_type: ev.message_type,
    user_id: ev.user_id != null ? String(ev.user_id) : undefined,
    group_id: ev.group_id != null ? String(ev.group_id) : undefined,
    endpoint,
    time: ev.time,
    self_id: selfId,
    role: ev.sender?.role,
    ...(nickname ? { nickname } : {}),
    ...(quoteId ? { quote_id: quoteId } : {}),
    ...(mentioned ? { mentioned: true } : {}),
  });
}

/**
 * canonical MediaRef → OneBot `file` 参数：url 直传、base64 → `base64://`、
 * 本地路径 → `file://`（路径在 OneBot 实现侧解析）、kind=file 不透明引用原样透传。
 */
export function mediaRefToOneBotFile(media: MediaRef): string {
  if (media.kind === 'base64') {
    return media.value.startsWith('base64://') ? media.value : `base64://${media.value}`;
  }
  if (media.kind === 'path') {
    return media.value.startsWith('file://') ? media.value : `file://${media.value}`;
  }
  return media.value;
}

/** 媒体段 data 里的 canonical-only 字段，不进 OneBot wire。 */
const MEDIA_DATA_SKIP_KEYS = new Set(['media', 'alt']);

/**
 * image / record / video 段：只消费 canonical `data.media` MediaRef，
 * 映射为 OneBot `file` 参数；无 MediaRef 时 warn + 丢弃（返回 null）。
 */
function oneBotMediaSegment(
  type: 'image' | 'record' | 'video',
  data: Record<string, unknown>,
): OneBot11Segment | null {
  if (!isMediaRef(data.media)) {
    logger.warn(formatCompact({
      op: 'onebot11_outbound_media_dropped',
      type,
      reason: 'missing_media_ref',
    }));
    return null;
  }
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!MEDIA_DATA_SKIP_KEYS.has(key)) extra[key] = value;
  }
  return { type, data: { ...extra, file: mediaRefToOneBotFile(data.media) } };
}

/**
 * canonical Segment → OneBot 11 数组段：
 * - mention → at（`qq: target`）；
 * - reply（`message_id`）→ reply（`id`）；
 * - image / audio→record / video 的 MediaRef → `file`（url / base64:// / file:// / 不透明引用）；
 * - file 段无 OneBot 11 消息段承载（文件走 upload_*_file API），warn + 丢弃；
 * - face 取 `id`；
 * - 其余（已是 wire 形状的段、平台扩展段）原样透传。
 * 返回 null 表示该段被丢弃。
 */
function canonicalToOneBotSegment(segment: OneBot11WireSegment): OneBot11Segment | null {
  const data = segment.data ?? {};
  switch (segment.type) {
    case 'mention': {
      const target = data.target ?? data.qq ?? data.id;
      if (target == null) return { type: segment.type, data };
      return { type: 'at', data: { qq: String(target) } };
    }
    case 'reply': {
      const messageId = data.message_id ?? data.id;
      if (messageId == null) return { type: segment.type, data };
      return { type: 'reply', data: { id: String(messageId) } };
    }
    case 'face': {
      if (data.id == null) return { type: segment.type, data };
      return { type: 'face', data: { id: data.id } };
    }
    case 'image':
    case 'record':
    case 'video':
      return oneBotMediaSegment(segment.type, data);
    case 'audio':
      return oneBotMediaSegment('record', data);
    case 'file':
      logger.warn(formatCompact({
        op: 'onebot11_outbound_media_dropped',
        type: 'file',
        reason: 'file_segment_not_supported',
      }));
      return null;
    default:
      return { type: segment.type, data };
  }
}

/**
 * Wire-encode an already-rendered outbound payload into OneBot 11 message segments.
 * 入参假定已经 core `normalizeOutboundPayload` 归一为 canonical Segment[]；
 * 媒体段只消费 canonical `data.media`（无 MediaRef 的媒体段 warn + 丢弃），
 * 其余 wire 形状段（at / 平台扩展段）原样透传。
 */
export function formatOutboundSegments(payload: unknown): OneBot11Segment[] {
  if (typeof payload === 'string') {
    return [{ type: 'text', data: { text: payload } }];
  }

  const items: Array<string | OneBot11WireSegment> = Array.isArray(payload)
    ? payload as Array<string | OneBot11WireSegment>
    : payload && typeof payload === 'object' && 'type' in (payload as object)
      ? [payload as OneBot11WireSegment]
      : [];

  if (items.length === 0) {
    const text = payload == null
      ? ''
      : typeof payload === 'object'
        ? JSON.stringify(payload)
        : String(payload);
    return [{ type: 'text', data: { text } }];
  }

  const segs: OneBot11Segment[] = [];
  for (const item of items) {
    if (typeof item === 'string') {
      segs.push({ type: 'text', data: { text: item } });
      continue;
    }
    const seg = canonicalToOneBotSegment(item);
    if (seg) segs.push(seg);
  }
  return segs.length ? segs : [{ type: 'text', data: { text: '' } }];
}

export function buildSendAction(
  conversation: ConversationRef,
  message: OneBot11Segment[],
): { action: string; params: Record<string, unknown> } {
  if (conversation.kind === 'group') {
    return {
      action: 'send_group_msg',
      params: {
        group_id: Number(conversation.id) || conversation.id,
        message,
      },
    };
  }
  return {
    action: 'send_private_msg',
    params: {
      user_id: Number(conversation.id) || conversation.id,
      message,
    },
  };
}

/** Build WS connect URL + headers (access_token via Bearer + query). */
export function buildWsConnectOptions(config: OneBot11WsConfig): {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly safeUrl: string;
} {
  const headers: Record<string, string> = {};
  let connectUrl = config.url;
  if (config.access_token) {
    headers.Authorization = `Bearer ${config.access_token}`;
    const url = new URL(config.url);
    url.searchParams.set('access_token', config.access_token);
    connectUrl = url.toString();
  }
  const safeUrl = new URL(connectUrl);
  safeUrl.searchParams.delete('access_token');
  return { url: connectUrl, headers, safeUrl: safeUrl.toString() };
}
