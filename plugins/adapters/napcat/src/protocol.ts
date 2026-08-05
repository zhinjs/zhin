/**
 * NapCat protocol helpers (OneBot 11 + NapCat extensions).
 * No legacy Adapter/Endpoint / segment-mapper.
 * Canonicalization is owned by gateway/core before endpoint.send.
 */
import { isMediaRef, type MediaRef } from '@zhin.js/core';
import type { ConversationRef } from '@zhin.js/im-contract';
import { formatCompact, getLogger } from '@zhin.js/logger';

const logger = getLogger('napcat');

/** Transitional legacy endpoint row (`endpoints[]` with `context: napcat`). */
export interface NapCatLegacyEndpointRow {
  readonly context?: string;
  readonly connection?: 'ws' | 'wss' | 'http';
  readonly name?: string;
  readonly access_token?: string;
  readonly url?: string;
  readonly path?: string;
  readonly http_url?: string;
  readonly post_path?: string;
  readonly reconnect_interval?: number;
  readonly heartbeat_interval?: number;
  readonly poll_interval?: number;
}

/** Plugin Runtime owner config (`plugins.<instanceKey>` / schema.json). */
export interface NapCatAdapterConfig {
  readonly connection?: 'ws' | 'wss' | 'http';
  readonly name?: string;
  readonly access_token?: string;
  readonly url?: string;
  readonly path?: string;
  readonly http_url?: string;
  readonly post_path?: string;
  readonly reconnect_interval?: number;
  readonly heartbeat_interval?: number;
  readonly poll_interval?: number;
  /** Transitional: legacy root `endpoints[]` with `context: napcat`. */
  readonly endpoints?: ReadonlyArray<NapCatLegacyEndpointRow>;
}

export interface NapCatConfigBase {
  readonly context: 'napcat';
  readonly name: string;
  readonly access_token?: string;
}

/** 正向 WebSocket：应用连 NapCat WS */
export interface NapCatWsConfig extends NapCatConfigBase {
  readonly connection: 'ws';
  readonly url: string;
  readonly reconnect_interval: number;
  readonly heartbeat_interval: number;
}

/** 反向 WebSocket：httpHostToken WS upgrade 入站/出站 */
export interface NapCatWssConfig extends NapCatConfigBase {
  readonly connection: 'wss';
  readonly path: string;
  readonly heartbeat_interval: number;
}

/** HTTP API + POST 上报：httpHostToken POST 入站 + http_url/{action} 出站 */
export interface NapCatHttpConfig extends NapCatConfigBase {
  readonly connection: 'http';
  readonly http_url: string;
  readonly post_path: string;
  readonly poll_interval: number;
}

export type ResolvedNapCatConfig = NapCatWsConfig | NapCatWssConfig | NapCatHttpConfig;
export type NapCatEndpointConfig = ResolvedNapCatConfig;

export interface NapCatSender {
  readonly role?: string;
  readonly nickname?: string;
  readonly card?: string;
  readonly title?: string;
  readonly user_id?: number;
}

export interface MessageSegment {
  type: string;
  data?: Record<string, unknown>;
}

export interface NapCatEvent {
  post_type: string;
  self_id?: number | string;
  message_type?: string;
  sub_type?: string;
  message_id?: number | string;
  user_id?: number | string;
  group_id?: number | string;
  sender?: NapCatSender;
  message?: MessageSegment[] | string;
  raw_message?: string;
  time?: number;
  notice_type?: string;
  request_type?: string;
  [key: string]: unknown;
}

export type NapCatMessageEvent = NapCatEvent & {
  post_type: 'message' | 'message_sent';
  message_id: number | string;
  user_id: number | string;
};

export interface NapCatActionRequest {
  action: string;
  params: Record<string, unknown>;
  echo?: string;
}

export interface NapCatActionResponse {
  status: string;
  retcode: number;
  data?: unknown;
  echo?: string;
  message?: string;
  wording?: string;
}

export interface NapCatWireSegment {
  readonly type: string;
  readonly data?: Record<string, unknown>;
}

export interface ParsedSendTarget {
  readonly message_type: 'private' | 'group';
  readonly id: string;
}

function normalizeConnection(
  connection: string | undefined,
): 'ws' | 'wss' | 'http' {
  if (connection === 'wss' || connection === 'http') return connection;
  return 'ws';
}

export function resolveNapCatConfig(config: NapCatAdapterConfig = {}): ResolvedNapCatConfig {
  const entry = config.endpoints?.find((item) => item.context === 'napcat');
  const connection = normalizeConnection(config.connection ?? entry?.connection);
  const name = (typeof config.name === 'string' && config.name)
    || (typeof entry?.name === 'string' && entry.name)
    || process.env.NAPCAT_BOT_NAME
    || 'napcat-bot';
  const access_token = config.access_token ?? entry?.access_token;

  if (connection === 'ws') {
    const url = config.url ?? entry?.url;
    if (!url) {
      throw new TypeError(
        'NapCat connection:ws requires url (plugins.<key>.url or endpoints with context: napcat)',
      );
    }
    return {
      context: 'napcat',
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
    if (!path) throw new TypeError('NapCat connection:wss requires path');
    return {
      context: 'napcat',
      connection: 'wss',
      name,
      access_token,
      path,
      heartbeat_interval: config.heartbeat_interval ?? entry?.heartbeat_interval ?? 30_000,
    };
  }

  if (connection === 'http') {
    const http_url = config.http_url ?? entry?.http_url;
    const post_path = config.post_path ?? entry?.post_path;
    if (!http_url || !post_path) {
      throw new TypeError('NapCat connection:http requires http_url and post_path');
    }
    return {
      context: 'napcat',
      connection: 'http',
      name,
      access_token,
      http_url,
      post_path,
      poll_interval: config.poll_interval ?? entry?.poll_interval ?? 30_000,
    };
  }

  throw new TypeError(`Unknown NapCat connection: ${String(connection)}`);
}

export function isMessageEvent(
  ev: NapCatEvent,
): ev is NapCatMessageEvent {
  return (ev.post_type === 'message' || ev.post_type === 'message_sent')
    && ev.message_id != null;
}

export function getChannelId(ev: NapCatEvent): string {
  if (ev.message_type === 'group' && ev.group_id != null) return String(ev.group_id);
  if (ev.group_id != null && ev.message_type !== 'private') return String(ev.group_id);
  if (ev.user_id != null) return String(ev.user_id);
  return '';
}

/**
 * 入站归一化 → ConversationRef：群消息 → kind 'group'；私聊临时会话
 * （sub_type 'group'）→ kind 'private' + 群容器进 `parent`；其余私聊 → 'private'。
 */
export function napcatInboundConversation(endpointId: string, ev: NapCatEvent): ConversationRef {
  const endpoint = { id: endpointId, adapter: endpointId.split('\0')[0] ?? endpointId };
  const isGroup = ev.message_type === 'group' || (ev.group_id != null && ev.message_type !== 'private');
  if (isGroup && ev.group_id != null) {
    return { endpoint, kind: 'group', id: String(ev.group_id) };
  }
  if (ev.sub_type === 'group' && ev.group_id != null) {
    return {
      endpoint,
      kind: 'private',
      id: ev.user_id != null ? String(ev.user_id) : '',
      parent: { kind: 'group', id: String(ev.group_id) },
    };
  }
  return { endpoint, kind: 'private', id: ev.user_id != null ? String(ev.user_id) : '' };
}

/** 出站：ConversationRef → OneBot 私聊/群聊目标。 */
export function napcatOutboundTarget(conversation: ConversationRef): ParsedSendTarget {
  return {
    message_type: conversation.kind === 'group' ? 'group' : 'private',
    id: conversation.id,
  };
}

export function formatInboundContent(ev: NapCatEvent): string {
  if (typeof ev.raw_message === 'string' && ev.raw_message) return ev.raw_message;
  if (Array.isArray(ev.message)) {
    return ev.message
      .map((seg) => (seg.type === 'text' ? String(seg.data?.text ?? '') : ''))
      .join('');
  }
  if (typeof ev.message === 'string') return ev.message;
  return '';
}

/**
 * 入站 sender 语义：必须是用户 ID（Runtime Message contract）。
 * 显示名走 metadata.nickname，见 senderNickname。
 */
export function senderUserId(ev: NapCatEvent): string {
  return ev.user_id != null ? String(ev.user_id) : '';
}

/** 显示名（群名片 card 优先于 nickname），没有则 undefined。 */
export function senderNickname(ev: NapCatEvent): string | undefined {
  const name = ev.sender?.card || ev.sender?.nickname;
  return typeof name === 'string' && name ? name : undefined;
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
const MEDIA_DATA_SKIP_KEYS = new Set(['media', 'alt', 'url', 'base64', 'file', 'mime_type']);

/**
 * 媒体段 → OneBot wire：媒体来源唯一认 canonical `data.media`（MediaRef-only，
 * 无 legacy 字段回读）。缺失或形状非法时 warn + 丢弃（返回 null）。
 */
function oneBotMediaSegment(
  type: 'image' | 'record' | 'video',
  data: Record<string, unknown>,
): MessageSegment | null {
  if (!isMediaRef(data.media)) {
    logger.warn(formatCompact({
      op: 'napcat_outbound_media_dropped',
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
 * - image / audio→record / video 的 MediaRef → `file`（url / base64:// / file://），
 *   无 canonical `data.media` 的媒体段丢弃（返回 null）；
 * - face 取 `id`；
 * - 其余（NapCat 扩展段、已是 wire 形状的段）原样透传。
 */
function canonicalToOneBotSegment(segment: NapCatWireSegment): MessageSegment | null {
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
    default:
      return { type: segment.type, data };
  }
}

/**
 * Wire-encode an already-rendered outbound payload into OneBot message segments.
 * 入参假定已经 core `normalizeOutboundPayload` 归一为 canonical Segment[]；
 * 媒体段（image/audio/video）仅认 canonical `data.media`，缺失则 warn + 丢弃；
 * 非媒体的 wire 段（at 等）原样透传。
 */
export function formatOutboundSegments(payload: unknown): MessageSegment[] {
  if (typeof payload === 'string') {
    return [{ type: 'text', data: { text: payload } }];
  }

  const items: Array<string | NapCatWireSegment> = Array.isArray(payload)
    ? payload as Array<string | NapCatWireSegment>
    : payload && typeof payload === 'object' && 'type' in (payload as object)
      ? [payload as NapCatWireSegment]
      : [];

  if (items.length === 0) {
    const text = payload == null
      ? ''
      : typeof payload === 'object'
        ? JSON.stringify(payload)
        : String(payload);
    return [{ type: 'text', data: { text } }];
  }

  const segs: MessageSegment[] = [];
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
  target: ParsedSendTarget,
  message: MessageSegment[],
): { action: string; params: Record<string, unknown> } {
  if (target.message_type === 'group') {
    return {
      action: 'send_group_msg',
      params: {
        group_id: Number(target.id) || target.id,
        message,
      },
    };
  }
  return {
    action: 'send_private_msg',
    params: {
      user_id: Number(target.id) || target.id,
      message,
    },
  };
}

/** Build WS connect URL + headers (access_token via Bearer + query). */
export function buildWsConnectOptions(config: NapCatWsConfig): {
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

export interface NapCatHttpOptions {
  readonly http_url: string;
  readonly access_token?: string;
}

/**
 * 向 NapCat HTTP API 发送动作请求：POST {http_url}/{action}。
 * 供 connection:http 出站与纯协议测试使用。
 */
export async function callNapCatHttpAction(
  options: NapCatHttpOptions,
  action: string,
  params: Record<string, unknown> = {},
): Promise<NapCatActionResponse> {
  const base = options.http_url.replace(/\/$/, '');
  const url = `${base}/${action}`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.access_token) {
    headers.Authorization = `Bearer ${options.access_token}`;
  }
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  });
  const text = await res.text();
  if (res.status === 401) throw new Error(`NapCat HTTP auth failed: ${text}`);
  if (res.status !== 200) throw new Error(`NapCat HTTP ${res.status}: ${text}`);
  let data: NapCatActionResponse;
  try {
    data = JSON.parse(text) as NapCatActionResponse;
  } catch {
    throw new Error(`NapCat HTTP invalid response: ${text.slice(0, 200)}`);
  }
  if (data.status !== 'ok' && data.retcode !== 0) {
    throw new Error(
      `NapCat HTTP action failed [${data.retcode}]: ${data.message || data.wording || 'unknown'}`,
    );
  }
  return data;
}
