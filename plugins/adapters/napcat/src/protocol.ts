/**
 * NapCat protocol helpers (OneBot 11 + NapCat extensions).
 * No legacy Adapter/Endpoint / segment-mapper.
 * Canonicalization is owned by gateway/core before endpoint.send.
 */

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

export function formatInboundTarget(ev: NapCatEvent): string {
  const messageType = ev.message_type === 'group' || (ev.group_id != null && ev.message_type !== 'private')
    ? 'group'
    : 'private';
  return `${messageType}:${getChannelId(ev)}`;
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

export function senderDisplayName(ev: NapCatEvent): string {
  const name = ev.sender?.card || ev.sender?.nickname;
  if (typeof name === 'string' && name) return name;
  return ev.user_id != null ? String(ev.user_id) : '';
}

/**
 * Wire-encode an already-rendered outbound payload into OneBot message segments.
 * Segment canonicalization is intentionally not done here.
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
    segs.push({ type: item.type, data: item.data ?? {} });
  }
  return segs.length ? segs : [{ type: 'text', data: { text: '' } }];
}

export function buildSendAction(
  target: string,
  message: MessageSegment[],
): { action: string; params: Record<string, unknown> } {
  const parsed = parseSendTarget(target);
  if (parsed.message_type === 'group') {
    return {
      action: 'send_group_msg',
      params: {
        group_id: Number(parsed.id) || parsed.id,
        message,
      },
    };
  }
  return {
    action: 'send_private_msg',
    params: {
      user_id: Number(parsed.id) || parsed.id,
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
