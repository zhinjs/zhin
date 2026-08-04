/**
 * Milky protocol helpers (no legacy Adapter/Endpoint / segment-mapper).
 * Canonicalization is owned by gateway/core before endpoint.send.
 * Spec: https://milky.ntqqrev.org/
 */

import { isMediaRef } from '@zhin.js/core';
import type { Segment } from '@zhin.js/core/runtime';
import { formatCompact, getLogger } from '@zhin.js/logger';

const logger = getLogger('milky');

/** Transitional legacy endpoint row (`endpoints[]` with `context: milky`). */
export interface MilkyLegacyEndpointRow {
  readonly context?: string;
  readonly connection?: 'ws' | 'sse' | 'webhook' | 'wss';
  readonly name?: string;
  readonly baseUrl?: string;
  readonly access_token?: string;
  readonly path?: string;
  readonly reconnect_interval?: number;
  readonly heartbeat_interval?: number;
}

/** Plugin Runtime owner config (`plugins.<instanceKey>` / schema.json). */
export interface MilkyAdapterConfig {
  readonly connection?: 'ws' | 'sse' | 'webhook' | 'wss';
  readonly name?: string;
  readonly baseUrl?: string;
  readonly access_token?: string;
  readonly path?: string;
  readonly reconnect_interval?: number;
  readonly heartbeat_interval?: number;
  /** Transitional: legacy root `endpoints[]` with `context: milky`. */
  readonly endpoints?: ReadonlyArray<MilkyLegacyEndpointRow>;
}

export interface MilkyConfigBase {
  readonly context: 'milky';
  readonly name: string;
  readonly baseUrl: string;
  readonly access_token?: string;
}

/** WebSocket 正向：应用连协议端 ws(s)://baseUrl/event */
export interface MilkyWsConfig extends MilkyConfigBase {
  readonly connection: 'ws';
  readonly reconnect_interval: number;
  readonly heartbeat_interval: number;
}

/** SSE：HTTP GET `text/event-stream` on `/event`（同 WS 事件流） */
export interface MilkySseConfig extends MilkyConfigBase {
  readonly connection: 'sse';
  readonly reconnect_interval: number;
}

/** Webhook：httpHostToken POST 入站 + baseUrl HTTP API 出站 */
export interface MilkyWebhookConfig extends MilkyConfigBase {
  readonly connection: 'webhook';
  readonly path: string;
}

/** 反向 WS：httpHostToken WS upgrade 入站 + baseUrl HTTP API 出站 */
export interface MilkyWssConfig extends MilkyConfigBase {
  readonly connection: 'wss';
  readonly path: string;
  readonly heartbeat_interval: number;
}

export type ResolvedMilkyConfig =
  | MilkyWsConfig
  | MilkySseConfig
  | MilkyWebhookConfig
  | MilkyWssConfig;
export type MilkyEndpointConfig = ResolvedMilkyConfig;

export interface MilkyApiResponse<T = unknown> {
  status: string;
  retcode: number;
  data?: T;
  message?: string;
}

export interface MilkyEvent {
  event_type: string;
  time: number;
  self_id: number;
  data?: Record<string, unknown>;
}

export interface MilkyIncomingMessage {
  message_scene: 'friend' | 'group' | 'temp';
  peer_id: number;
  message_seq: number;
  sender_id: number;
  time: number;
  segments: MilkyIncomingSegment[];
  friend?: { user_id: number; nickname?: string };
  group?: { group_id: number; group_name?: string };
  group_member?: { user_id: number; nickname?: string; card?: string; role?: string };
}

export interface MilkyIncomingSegment {
  type: string;
  data?: Record<string, unknown>;
}

export interface MilkyWireSegment {
  readonly type: string;
  readonly data?: Record<string, unknown>;
}

export interface MilkyOutgoingSegment {
  type: string;
  data: Record<string, unknown>;
}

export interface ParsedSendTarget {
  readonly message_type: 'private' | 'group';
  readonly id: string;
}

export interface MilkyApiClientOptions {
  readonly baseUrl: string;
  readonly access_token?: string;
}

function normalizeConnection(connection: string | undefined): 'ws' | 'sse' | 'webhook' | 'wss' {
  if (connection === 'sse' || connection === 'webhook' || connection === 'wss') return connection;
  return 'ws';
}

export function resolveMilkyConfig(config: MilkyAdapterConfig = {}): ResolvedMilkyConfig {
  const entry = config.endpoints?.find((item) => item.context === 'milky');
  const connection = normalizeConnection(config.connection ?? entry?.connection);
  const name = (typeof config.name === 'string' && config.name)
    || (typeof entry?.name === 'string' && entry.name)
    || process.env.MILKY_BOT_NAME
    || 'milky-bot';
  const baseUrl = config.baseUrl ?? entry?.baseUrl;
  if (!baseUrl) {
    throw new TypeError(
      'Milky requires baseUrl (plugins.<key>.baseUrl or endpoints with context: milky)',
    );
  }
  const access_token = config.access_token ?? entry?.access_token;
  const base = {
    context: 'milky' as const,
    name,
    baseUrl,
    access_token,
  };

  if (connection === 'ws') {
    return {
      ...base,
      connection: 'ws',
      reconnect_interval: config.reconnect_interval ?? entry?.reconnect_interval ?? 5000,
      heartbeat_interval: config.heartbeat_interval ?? entry?.heartbeat_interval ?? 30_000,
    };
  }

  if (connection === 'sse') {
    return {
      ...base,
      connection: 'sse',
      reconnect_interval: config.reconnect_interval
        ?? entry?.reconnect_interval
        ?? 5_000,
    };
  }

  if (connection === 'webhook') {
    const path = config.path ?? entry?.path;
    if (!path) throw new TypeError('Milky connection:webhook requires path');
    return { ...base, connection: 'webhook', path };
  }

  if (connection === 'wss') {
    const path = config.path ?? entry?.path;
    if (!path) throw new TypeError('Milky connection:wss requires path');
    return {
      ...base,
      connection: 'wss',
      path,
      heartbeat_interval: config.heartbeat_interval ?? entry?.heartbeat_interval ?? 30_000,
    };
  }

  throw new TypeError(`Unknown Milky connection: ${String(connection)}`);
}

/** 鉴权：Header Authorization: Bearer {token} 或 URL query access_token=xxx */
function authHeaders(access_token?: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (access_token) {
    headers.Authorization = `Bearer ${access_token}`;
  }
  return headers;
}

function authQuery(access_token?: string): string {
  if (!access_token) return '';
  return `access_token=${encodeURIComponent(access_token)}`;
}

/**
 * 调用协议端 API：POST {baseUrl}/api/{apiName}，Body JSON，鉴权。
 * 非 200 或 retcode !== 0 时抛错。
 */
export async function callApi<T = unknown>(
  options: MilkyApiClientOptions,
  apiName: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const { baseUrl, access_token } = options;
  const url = new URL(`/api/${apiName}`, baseUrl.replace(/\/$/, ''));
  const q = authQuery(access_token);
  if (q) url.search = (url.search ? `${url.search}&` : '') + q;

  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(access_token),
    },
    body: JSON.stringify(Object.keys(params).length ? params : {}),
  });

  const text = await res.text();
  let body: MilkyApiResponse<T>;
  try {
    body = JSON.parse(text) as MilkyApiResponse<T>;
  } catch {
    throw new Error(`Milky API ${apiName}: invalid JSON response (${res.status}) ${text.slice(0, 200)}`);
  }

  if (res.status !== 200) {
    throw new Error(`Milky API ${apiName}: HTTP ${res.status} ${body.message ?? text}`);
  }
  if (body.retcode !== 0) {
    throw new Error(`Milky API ${apiName}: retcode=${body.retcode} ${body.message ?? ''}`);
  }
  return (body.data ?? {}) as T;
}

/** 根据 event_type 判断是否为 message_receive，并解析 data */
export function parseMessageReceiveData(event: MilkyEvent): MilkyIncomingMessage | null {
  if (event.event_type !== 'message_receive' || !event.data) return null;
  const data = event.data as unknown as MilkyIncomingMessage;
  if (!data.message_scene || !Number.isInteger(data.peer_id) || !Array.isArray(data.segments)) {
    return null;
  }
  return data;
}

export function isMessageReceiveEvent(
  event: MilkyEvent,
): event is MilkyEvent & { data: MilkyIncomingMessage } {
  return parseMessageReceiveData(event) != null;
}

/** Gateway reply target：`private:uid` / `group:gid` */
export function formatInboundTarget(data: MilkyIncomingMessage): string {
  const isGroup = data.message_scene === 'group';
  return `${isGroup ? 'group' : 'private'}:${data.peer_id}`;
}

export function formatInboundContent(data: MilkyIncomingMessage): string {
  return data.segments.map((seg) => {
    if (seg.type === 'text') return String(seg.data?.text ?? '');
    if (seg.type === 'record' || seg.type === 'audio') {
      const uri = String(seg.data?.uri ?? seg.data?.url ?? '');
      return uri ? `[audio:${uri}]` : '[audio]';
    }
    return '';
  }).join('');
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

/**
 * 入站消息段 → canonical Segment[]（与 formatInboundContent 纯文本视图同源双轨）。
 * 媒体段（image/record/video）优先 temp_url（kind=url），缺 URL 时回退
 * resource_id（kind=file，平台不透明引用，经协议端 get_resource 解析）；
 * file 段只有 file_id（kind=file）。未识别段类型按宽松段透传，不丢信息。
 */
export function formatInboundSegments(data: MilkyIncomingMessage): Segment[] {
  const out: Segment[] = [];
  for (const seg of data.segments) {
    const segData = seg.data ?? {};
    switch (seg.type) {
      case 'text': {
        const text = String(segData.text ?? '');
        if (text) out.push({ type: 'text', data: { text } });
        break;
      }
      case 'mention':
        out.push({
          type: 'mention',
          data: {
            target: String(segData.user_id ?? ''),
            ...(typeof segData.name === 'string' && segData.name
              ? { name: segData.name }
              : {}),
          },
        });
        break;
      case 'mention_all':
        out.push({ type: 'mention', data: { target: 'all' } });
        break;
      case 'face': {
        const id = firstNonEmptyString(segData.face_id, segData.id);
        if (id) out.push({ type: 'face', data: { id } });
        break;
      }
      case 'reply': {
        const seq = Number(segData.message_seq);
        if (Number.isFinite(seq)) {
          // 与 formatInboundMessageId 同一复合格式，保证 reply 链可定位原消息
          out.push({
            type: 'reply',
            data: { message_id: `${data.message_scene}:${data.peer_id}:${seq}` },
          });
        }
        break;
      }
      case 'image':
      case 'record':
      case 'audio':
      case 'video': {
        const url = firstNonEmptyString(segData.temp_url, segData.uri, segData.url);
        const resourceId = firstNonEmptyString(segData.resource_id);
        if (!url && !resourceId) break;
        const type = seg.type === 'image'
          ? 'image'
          : seg.type === 'video'
            ? 'video'
            : 'audio';
        out.push({
          type,
          data: {
            media: url
              ? { kind: 'url', value: url }
              : { kind: 'file', value: resourceId! },
            ...(typeof segData.summary === 'string' && segData.summary
              ? { alt: segData.summary }
              : {}),
          },
        });
        break;
      }
      case 'file': {
        const fileId = firstNonEmptyString(segData.file_id);
        if (!fileId) break;
        out.push({
          type: 'file',
          data: {
            media: { kind: 'file', value: fileId },
            ...(typeof segData.file_name === 'string' && segData.file_name
              ? { name: segData.file_name }
              : {}),
            ...(typeof segData.file_size === 'number'
              ? { size: segData.file_size }
              : {}),
          },
        });
        break;
      }
      case 'forward': {
        const forwardId = firstNonEmptyString(segData.forward_id);
        if (forwardId) {
          out.push({
            type: 'forward',
            data: {
              forward_id: forwardId,
              ...(typeof segData.title === 'string' && segData.title
                ? { title: segData.title }
                : {}),
            },
          });
        }
        break;
      }
      default:
        // 未识别段（market_face / light_app / xml 等）按宽松 canonical 段透传
        out.push({ type: seg.type, data: segData });
    }
  }
  return out;
}

/** First audio URI from inbound segments (for Agent Host STT preprocess). */
export function extractInboundAudioUrl(data: MilkyIncomingMessage): string | undefined {
  for (const seg of data.segments) {
    if (seg.type !== 'record' && seg.type !== 'audio') continue;
    const uri = String(seg.data?.uri ?? seg.data?.url ?? '').trim();
    if (uri) return uri;
  }
  return undefined;
}

/** 发送者显示名（群名片/群昵称/好友昵称）；没有可靠的显示名时返回 undefined。 */
export function senderNickname(data: MilkyIncomingMessage): string | undefined {
  const isGroup = data.message_scene === 'group';
  const name = isGroup
    ? data.group_member?.card ?? data.group_member?.nickname
    : data.friend?.nickname;
  return typeof name === 'string' && name ? name : undefined;
}

/** 消息段中含 @ 本机（mention 段 user_id 等于协议端上报的 self_id）。 */
export function isMentioned(data: MilkyIncomingMessage, selfId: number | undefined): boolean {
  if (selfId == null) return false;
  return data.segments.some(
    (seg) => seg.type === 'mention' && Number(seg.data?.user_id) === selfId,
  );
}

export function formatInboundMessageId(data: MilkyIncomingMessage): string {
  return `${data.message_scene}:${data.peer_id}:${data.message_seq}`;
}

export function parseSendTarget(target: string): ParsedSendTarget {
  const sep = target.indexOf(':');
  if (sep <= 0) {
    return { message_type: 'private', id: target };
  }
  const head = target.slice(0, sep);
  const rest = target.slice(sep + 1);
  if (head === 'group') return { message_type: 'group', id: rest };
  if (head === 'private') return { message_type: 'private', id: rest };
  return { message_type: 'private', id: target };
}

/**
 * 解析 image/audio/video 段的投递 uri（canonical MediaRef 唯一来源）：
 * - kind=url → http(s):// 直发；
 * - kind=base64 → base64:// 直发；
 * - kind=path / file → Milky 资源 uri 仅消费 http(s):// 与 base64://，不支持，丢弃。
 */
function resolveMediaUri(data: Record<string, unknown>): string | undefined {
  const media = data.media;
  if (!isMediaRef(media)) return undefined;
  if (media.kind === 'url') return media.value;
  if (media.kind === 'base64') {
    return media.value.startsWith('base64://') ? media.value : `base64://${media.value}`;
  }
  return undefined;
}

/** 媒体段 → Milky 资源段（image/record/video）；不可投递时 warn + 丢弃。 */
function normalizeMediaSegment(seg: MilkyWireSegment): MilkyOutgoingSegment | null {
  const data = seg.data ?? {};
  const wireType = seg.type === 'image'
    ? 'image'
    : seg.type === 'video'
      ? 'video'
      : 'record';
  const uri = resolveMediaUri(data);
  if (!uri) {
    const media = data.media;
    logger.warn(formatCompact({
      op: 'milky_outbound_media_dropped',
      type: seg.type,
      reason: isMediaRef(media) ? 'unsupported_media_kind' : 'missing_media_ref',
      ...(isMediaRef(media) ? { kind: media.kind } : {}),
    }));
    return null;
  }
  return {
    type: wireType,
    data: wireType === 'video' ? { uri, thumb_uri: data.thumb_uri } : { uri },
  };
}

/**
 * Wire-encode an already-rendered outbound payload into Milky outgoing segments.
 * Segment canonicalization is intentionally not done here.
 * 媒体段（image/audio/record/video）只消费 canonical `data.media` MediaRef；
 * file 段 Milky 消息 API 无对应 wire 段（文件走 upload_* API），warn + 丢弃。
 */
export function formatOutboundSegments(payload: unknown): MilkyOutgoingSegment[] {
  if (typeof payload === 'string') {
    return [{ type: 'text', data: { text: payload } }];
  }

  const items: Array<string | MilkyWireSegment> = Array.isArray(payload)
    ? payload as Array<string | MilkyWireSegment>
    : payload && typeof payload === 'object' && 'type' in (payload as object)
      ? [payload as MilkyWireSegment]
      : [];

  if (items.length === 0) {
    const text = payload == null
      ? ''
      : typeof payload === 'object'
        ? JSON.stringify(payload)
        : String(payload);
    return [{ type: 'text', data: { text } }];
  }

  const out: MilkyOutgoingSegment[] = [];
  for (const item of items) {
    if (typeof item === 'string') {
      out.push({ type: 'text', data: { text: item } });
      continue;
    }
    const type = item.type;
    const data = item.data ?? {};
    switch (type) {
      case 'text':
        out.push({ type: 'text', data: { text: String(data.text ?? '') } });
        break;
      case 'at':
        if (data.type === 'all') {
          out.push({ type: 'mention_all', data: {} });
        } else {
          const id = data.id;
          if (id) out.push({ type: 'mention', data: { user_id: Number(id) || 0 } });
        }
        break;
      case 'mention':
        out.push({ type: 'mention', data: { user_id: Number(data.user_id ?? data.id ?? 0) || 0 } });
        break;
      case 'mention_all':
        out.push({ type: 'mention_all', data: {} });
        break;
      case 'face':
        out.push({
          type: 'face',
          data: { face_id: String(data.face_id ?? data.id ?? ''), is_large: false },
        });
        break;
      case 'reply': {
        const mid = data.message_id ?? data.message_seq;
        const seq = typeof mid === 'number'
          ? mid
          : parseInt(String(mid).split(':').pop() ?? '0', 10);
        out.push({ type: 'reply', data: { message_seq: seq } });
        break;
      }
      case 'image':
      case 'record':
      case 'audio':
      case 'video': {
        const media = normalizeMediaSegment(item);
        if (media) out.push(media);
        break;
      }
      case 'file':
        // Milky 消息 API 无 file 段（文件走 upload_private/group_file），无法投递
        logger.warn(formatCompact({
          op: 'milky_outbound_media_dropped',
          type,
          reason: 'unsupported_segment',
        }));
        break;
      default:
        out.push({ type, data: data as Record<string, unknown> });
    }
  }
  return out.length ? out : [{ type: 'text', data: { text: '' } }];
}

export function buildSendAction(
  target: string,
  message: MilkyOutgoingSegment[],
): { action: string; params: Record<string, unknown> } {
  const parsed = parseSendTarget(target);
  if (parsed.message_type === 'group') {
    return {
      action: 'send_group_message',
      params: {
        group_id: parseInt(parsed.id, 10),
        message,
      },
    };
  }
  return {
    action: 'send_private_message',
    params: {
      user_id: parseInt(parsed.id, 10),
      message,
    },
  };
}

/** message_seq result → gateway message id */
export function formatOutboundMessageId(
  target: string,
  messageSeq: number | undefined,
): string {
  if (messageSeq == null) return '';
  const parsed = parseSendTarget(target);
  const scene = parsed.message_type === 'group' ? 'group' : 'friend';
  return `${scene}:${parsed.id}:${messageSeq}`;
}

export function parseMilkyMessageId(
  msgId: string,
): { message_scene: 'friend' | 'group' | 'temp'; peer_id: number; message_seq: number } | null {
  const parts = msgId.split(':');
  if (parts.length < 3) return null;
  const [scene, peer, seq] = parts;
  if (scene !== 'friend' && scene !== 'group' && scene !== 'temp') return null;
  const peerId = parseInt(peer!, 10);
  const messageSeq = parseInt(seq!, 10);
  if (Number.isNaN(peerId) || Number.isNaN(messageSeq)) return null;
  return { message_scene: scene, peer_id: peerId, message_seq: messageSeq };
}

/** Build WS event URL + headers (access_token via Bearer + query). */
export function buildWsConnectOptions(config: MilkyWsConfig): {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly safeUrl: string;
} {
  const base = config.baseUrl.replace(/\/$/, '');
  let url = `${base.replace(/^http/, 'ws')}/event`;
  const headers: Record<string, string> = {};
  if (config.access_token) {
    headers.Authorization = `Bearer ${config.access_token}`;
    url = `${url}${url.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(config.access_token)}`;
  }
  const safeUrl = url.replace(/([?&]access_token=)[^&]*/g, '$1***');
  return { url, headers, safeUrl };
}

/** Build SSE event URL (HTTP) + headers. */
export function buildSseConnectOptions(config: MilkySseConfig): {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly safeUrl: string;
} {
  const base = config.baseUrl.replace(/\/$/, '');
  let url = `${base}/event`;
  const headers: Record<string, string> = {
    Accept: 'text/event-stream',
  };
  if (config.access_token) {
    headers.Authorization = `Bearer ${config.access_token}`;
    url = `${url}${url.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(config.access_token)}`;
  }
  const safeUrl = url.replace(/([?&]access_token=)[^&]*/g, '$1***');
  return { url, headers, safeUrl };
}
