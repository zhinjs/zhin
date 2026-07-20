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
