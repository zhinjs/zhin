/**
 * OneBot 11 protocol helpers (no legacy Adapter/Endpoint / segment-mapper).
 * Canonicalization is owned by gateway/core before endpoint.send.
 * Spec: https://github.com/botuniverse/onebot-11
 */

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

export interface ParsedSendTarget {
  readonly message_type: 'private' | 'group';
  readonly id: string;
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
 * Gateway reply target：`private:uid` / `group:gid`，便于 send() 还原动作参数。
 */
export function formatInboundTarget(ev: OneBot11Event): string {
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
  if (head === 'group') {
    return { message_type: 'group', id: rest };
  }
  if (head === 'private') {
    return { message_type: 'private', id: rest };
  }
  return { message_type: 'private', id: target };
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
 * Wire-encode an already-rendered outbound payload into OneBot 11 message segments.
 * Segment canonicalization is intentionally not done here.
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
    segs.push({ type: item.type, data: item.data ?? {} });
  }
  return segs.length ? segs : [{ type: 'text', data: { text: '' } }];
}

export function buildSendAction(
  target: string,
  message: OneBot11Segment[],
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
