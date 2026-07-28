/**
 * OneBot 12 protocol helpers (no legacy Adapter/Endpoint / segment-mapper).
 * Canonicalization is owned by gateway/core before endpoint.send.
 * Spec: https://12.onebot.dev/
 */
import { isMediaRef, mediaRefFromLegacyData, type MediaRef } from '@zhin.js/core';

/** Transitional legacy endpoint row (`endpoints[]` with `context: onebot12`). */
export interface OneBot12LegacyEndpointRow {
  readonly context?: string;
  readonly connection?: 'ws' | 'webhook' | 'wss';
  readonly name?: string;
  readonly access_token?: string;
  readonly url?: string;
  readonly path?: string;
  readonly api_url?: string;
  readonly reconnect_interval?: number;
  readonly heartbeat_interval?: number;
}

/** Plugin Runtime owner config (`plugins.<instanceKey>` / schema.json). */
export interface OneBot12AdapterConfig {
  readonly connection?: 'ws' | 'webhook' | 'wss';
  readonly name?: string;
  readonly access_token?: string;
  readonly url?: string;
  readonly path?: string;
  readonly api_url?: string;
  readonly reconnect_interval?: number;
  readonly heartbeat_interval?: number;
  /** Transitional: legacy root `endpoints[]` with `context: onebot12`. */
  readonly endpoints?: ReadonlyArray<OneBot12LegacyEndpointRow>;
}

export interface OneBot12ConfigBase {
  readonly context: 'onebot12';
  readonly name: string;
  readonly access_token?: string;
}

/** 正向 WebSocket：应用连 OneBot 实现的 WS 服务器 */
export interface OneBot12WsConfig extends OneBot12ConfigBase {
  readonly connection: 'ws';
  readonly url: string;
  readonly reconnect_interval: number;
  readonly heartbeat_interval: number;
}

/** HTTP Webhook：httpHostToken POST 入站 + api_url HTTP 出站 */
export interface OneBot12WebhookConfig extends OneBot12ConfigBase {
  readonly connection: 'webhook';
  readonly path: string;
  readonly api_url?: string;
}

/** 反向 WebSocket：httpHostToken WS upgrade 入站/出站 */
export interface OneBot12WssConfig extends OneBot12ConfigBase {
  readonly connection: 'wss';
  readonly path: string;
  readonly heartbeat_interval: number;
}

export type ResolvedOneBot12Config = OneBot12WsConfig | OneBot12WebhookConfig | OneBot12WssConfig;
export type OneBot12EndpointConfig = ResolvedOneBot12Config;

export interface OneBot12Self {
  readonly platform: string;
  readonly user_id: string;
}

export interface OneBot12Event {
  id: string;
  time: number;
  type: 'meta' | 'message' | 'notice' | 'request';
  detail_type: string;
  sub_type: string;
  self?: OneBot12Self;
  message_id?: string;
  message?: OneBot12Segment[];
  alt_message?: string;
  user_id?: string;
  group_id?: string;
  channel_id?: string;
  guild_id?: string;
  [key: string]: unknown;
}

export interface OneBot12Segment {
  type: string;
  data?: Record<string, unknown>;
}

export interface OneBot12ActionRequest {
  action: string;
  params: Record<string, unknown>;
  echo?: string;
  self?: OneBot12Self;
}

export interface OneBot12ActionResponse {
  status: 'ok' | 'failed';
  retcode: number;
  data?: unknown;
  message: string;
  echo?: string;
}

export interface OneBot12HttpOptions {
  readonly url: string;
  readonly access_token?: string;
}

export interface OneBot12WireSegment {
  readonly type: string;
  readonly data?: Record<string, unknown>;
}

export interface ParsedSendTarget {
  readonly detail_type: 'private' | 'group' | 'channel';
  readonly id: string;
  readonly guild_id?: string;
}

export function resolveOneBot12Config(config: OneBot12AdapterConfig = {}): ResolvedOneBot12Config {
  const entry = config.endpoints?.find((item) => item.context === 'onebot12');
  const connection = config.connection
    ?? entry?.connection
    ?? 'ws';
  const name = (typeof config.name === 'string' && config.name)
    || (typeof entry?.name === 'string' && entry.name)
    || process.env.ONEBOT12_BOT_NAME
    || 'onebot12-bot';
  const access_token = config.access_token ?? entry?.access_token;

  if (connection === 'ws') {
    const url = config.url ?? entry?.url;
    if (!url) {
      throw new TypeError(
        'OneBot12 connection:ws requires url (plugins.<key>.url or endpoints with context: onebot12)',
      );
    }
    return {
      context: 'onebot12',
      connection: 'ws',
      name,
      access_token,
      url,
      reconnect_interval: config.reconnect_interval ?? entry?.reconnect_interval ?? 5000,
      heartbeat_interval: config.heartbeat_interval ?? entry?.heartbeat_interval ?? 30_000,
    };
  }

  if (connection === 'webhook') {
    const path = config.path ?? entry?.path;
    if (!path) {
      throw new TypeError('OneBot12 connection:webhook requires path');
    }
    return {
      context: 'onebot12',
      connection: 'webhook',
      name,
      access_token,
      path,
      api_url: config.api_url ?? entry?.api_url,
    };
  }

  if (connection === 'wss') {
    const path = config.path ?? entry?.path;
    if (!path) {
      throw new TypeError('OneBot12 connection:wss requires path');
    }
    return {
      context: 'onebot12',
      connection: 'wss',
      name,
      access_token,
      path,
      heartbeat_interval: config.heartbeat_interval ?? entry?.heartbeat_interval ?? 30_000,
    };
  }

  throw new TypeError(`Unknown OneBot12 connection: ${String(connection)}`);
}

/** 判断是否为消息事件（type=message） */
export function isMessageEvent(
  ev: OneBot12Event,
): ev is OneBot12Event & { message_id: string; message?: OneBot12Segment[] } {
  return ev.type === 'message' && !!ev.message_id;
}

/** 从事件得到场景 id：私聊 user_id，群 group_id，频道 channel_id 或 guild_id:channel_id */
export function getChannelId(ev: OneBot12Event): string {
  if (ev.detail_type === 'private' && ev.user_id) return ev.user_id;
  if (ev.detail_type === 'group' && ev.group_id) return ev.group_id;
  if (ev.detail_type === 'channel' && ev.channel_id) {
    return ev.guild_id ? `${ev.guild_id}:${ev.channel_id}` : ev.channel_id;
  }
  return ev.user_id ?? ev.group_id ?? '';
}

/**
 * Gateway reply target：`detail_type:channelId`，便于 send() 还原动作参数。
 */
export function formatInboundTarget(ev: OneBot12Event): string {
  const detail = ev.detail_type === 'private' || ev.detail_type === 'group' || ev.detail_type === 'channel'
    ? ev.detail_type
    : 'private';
  return `${detail}:${getChannelId(ev)}`;
}

export function parseSendTarget(target: string): ParsedSendTarget {
  const sep = target.indexOf(':');
  if (sep <= 0) {
    return { detail_type: 'private', id: target };
  }
  const head = target.slice(0, sep);
  const rest = target.slice(sep + 1);
  if (head === 'private' || head === 'group') {
    return { detail_type: head, id: rest };
  }
  if (head === 'channel') {
    const guildSep = rest.indexOf(':');
    if (guildSep > 0) {
      return {
        detail_type: 'channel',
        guild_id: rest.slice(0, guildSep),
        id: rest.slice(guildSep + 1),
      };
    }
    return { detail_type: 'channel', id: rest };
  }
  return { detail_type: 'private', id: target };
}

/** Build inbound text for MessageGateway.receive */
export function formatInboundContent(ev: OneBot12Event): string {
  if (typeof ev.alt_message === 'string' && ev.alt_message) return ev.alt_message;
  if (Array.isArray(ev.message)) {
    return ev.message
      .map((seg) => (seg.type === 'text' ? String(seg.data?.text ?? '') : ''))
      .join('');
  }
  return '';
}

/**
 * Runtime Message sender 必须是用户 ID（agent bridge 以 sender 与 endpointMaster 比对）。
 * 显示名经 {@link senderNickname} 放入 metadata.nickname。
 */
export function senderUserId(ev: OneBot12Event): string {
  return ev.user_id ?? '';
}

/** 事件携带的发送者显示名（`user.name` / `qq.nickname`），没有则返回 undefined。 */
export function senderNickname(ev: OneBot12Event): string | undefined {
  const record = ev as Record<string, unknown>;
  const name = record['user.name'] ?? record['qq.nickname'];
  if (typeof name === 'string' && name) return name;
  return undefined;
}

/**
 * 判断入站消息是否 @ 了本机：OneBot12 提及段为 `{type:'mention', data:{user_id}}`，
 * 目标 user_id 等于事件 self.user_id（self 为 {platform, user_id} 对象）时视为提及。
 * 新 Plugin Runtime 的 Message.content 为纯文本，mention 信息只能经 metadata.mentioned 传递。
 */
export function isBotMentioned(ev: OneBot12Event): boolean {
  const selfId = ev.self?.user_id;
  if (!selfId || !Array.isArray(ev.message)) return false;
  return ev.message.some(
    (seg) => seg.type === 'mention' && String(seg.data?.['user_id'] ?? '') === selfId,
  );
}

/** OneBot 12 携带媒体的段类型。 */
const ONEBOT12_MEDIA_TYPES = new Set(['image', 'voice', 'audio', 'video', 'file']);

/** 媒体段 data 里的 canonical-only / legacy 媒体字段，归一后不重复进 wire。 */
const MEDIA_DATA_SKIP_KEYS = new Set([
  'media', 'alt', 'mime_type', 'url', 'file', 'base64', 'data', 'path',
]);

/**
 * canonical MediaRef → OneBot 12 媒体字段。
 * spec 正式投递形状是 `file_id`（先 upload_file 物化，后续波次再接）；
 * 这里按常见扩展字段输出：url → `url`、base64 → `data`、本地路径 → `path`。
 */
export function mediaRefToOneBot12Fields(media: MediaRef): Record<string, unknown> {
  if (media.kind === 'base64') {
    const value = media.value.startsWith('base64://')
      ? media.value.slice('base64://'.length)
      : media.value;
    return { data: value };
  }
  if (media.kind === 'path') {
    return { path: media.value.startsWith('file://') ? media.value.slice('file://'.length) : media.value };
  }
  return { url: media.value };
}

function oneBot12MediaSegment(
  type: string,
  data: Record<string, unknown>,
): OneBot12Segment {
  // 已物化为 file_id 的段是 spec 正式形状，原样透传。
  if (typeof data.file_id === 'string' && data.file_id) return { type, data };
  const media = isMediaRef(data.media) ? data.media : mediaRefFromLegacyData(data);
  if (!media) return { type, data };
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!MEDIA_DATA_SKIP_KEYS.has(key)) extra[key] = value;
  }
  return { type, data: { ...extra, ...mediaRefToOneBot12Fields(media) } };
}

/**
 * canonical Segment → OneBot 12 数组段：
 * - mention → mention（`user_id: target`，`target: 'all'` → mention_all）；
 * - reply（`message_id`）→ reply（`message_id`）；
 * - image / voice / audio / video / file 的 MediaRef → url/data/path 扩展字段；
 * - 其余（已是 wire 形状的段、平台扩展段）原样透传。
 */
function canonicalToOneBotSegment(segment: OneBot12WireSegment): OneBot12Segment {
  const data = segment.data ?? {};
  switch (segment.type) {
    case 'mention': {
      const target = data.target ?? data.user_id ?? data.id;
      if (target == null) return { type: segment.type, data };
      if (String(target) === 'all') return { type: 'mention_all', data: {} };
      return { type: 'mention', data: { user_id: String(target) } };
    }
    case 'reply': {
      const messageId = data.message_id ?? data.id;
      if (messageId == null) return { type: segment.type, data };
      return { type: 'reply', data: { message_id: String(messageId) } };
    }
    default:
      if (ONEBOT12_MEDIA_TYPES.has(segment.type)) {
        return oneBot12MediaSegment(segment.type, data);
      }
      return { type: segment.type, data };
  }
}

/**
 * Wire-encode an already-rendered outbound payload into OneBot 12 message segments.
 * 入参假定已经 core `normalizeOutboundPayload` 归一为 canonical Segment[]；
 * 旧 wire 形状（mention / 裸 `{url,file,base64}`）保持兼容透传。
 */
export function formatOutboundSegments(payload: unknown): OneBot12Segment[] {
  if (typeof payload === 'string') {
    return [{ type: 'text', data: { text: payload } }];
  }

  const items: Array<string | OneBot12WireSegment> = Array.isArray(payload)
    ? payload as Array<string | OneBot12WireSegment>
    : payload && typeof payload === 'object' && 'type' in (payload as object)
      ? [payload as OneBot12WireSegment]
      : [];

  if (items.length === 0) {
    const text = payload == null
      ? ''
      : typeof payload === 'object'
        ? JSON.stringify(payload)
        : String(payload);
    return [{ type: 'text', data: { text } }];
  }

  const segs: OneBot12Segment[] = [];
  for (const item of items) {
    if (typeof item === 'string') {
      segs.push({ type: 'text', data: { text: item } });
      continue;
    }
    segs.push(canonicalToOneBotSegment(item));
  }
  return segs.length ? segs : [{ type: 'text', data: { text: '' } }];
}

export function buildSendMessageParams(
  target: string,
  message: OneBot12Segment[],
): Record<string, unknown> {
  const parsed = parseSendTarget(target);
  const params: Record<string, unknown> = {
    message,
    detail_type: parsed.detail_type,
  };
  if (parsed.detail_type === 'private') {
    params.user_id = parsed.id;
  } else if (parsed.detail_type === 'group') {
    params.group_id = parsed.id;
  } else {
    params.channel_id = parsed.id;
    if (parsed.guild_id) params.guild_id = parsed.guild_id;
  }
  return params;
}

/**
 * 向 OneBot 实现发送动作请求（HTTP POST），返回动作响应。
 * 供 webhook 出站与纯协议测试使用；WS 路径走 WebSocket echo 请求。
 */
export async function callOneBot12Action(
  options: OneBot12HttpOptions,
  action: string,
  params: Record<string, unknown> = {},
  echo?: string,
): Promise<OneBot12ActionResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.access_token) {
    headers.Authorization = `Bearer ${options.access_token}`;
  }
  const body: OneBot12ActionRequest = { action, params };
  if (echo) body.echo = echo;

  const res = await fetch(options.url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  const text = await res.text();
  if (res.status === 401) throw new Error(`OneBot12 鉴权失败: ${text}`);
  if (res.status !== 200) throw new Error(`OneBot12 HTTP ${res.status}: ${text}`);

  let data: OneBot12ActionResponse;
  try {
    data = JSON.parse(text) as OneBot12ActionResponse;
  } catch {
    throw new Error(`OneBot12 无效响应: ${text.slice(0, 200)}`);
  }
  if (data.status === 'failed' && data.retcode !== 0) {
    throw new Error(`OneBot12 动作失败 retcode=${data.retcode}: ${data.message}`);
  }
  return data;
}

/** Build WS connect URL + headers (access_token via Bearer + query). */
export function buildWsConnectOptions(config: OneBot12WsConfig): {
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
