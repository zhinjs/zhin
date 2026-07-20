/**
 * Satori protocol helpers (no legacy Adapter/Endpoint / segment-mapper).
 * Canonicalization is owned by gateway/core before endpoint.send.
 * Spec: https://satori.chat/zh-CN/protocol/overview.html
 */

import { pickCredential } from '@zhin.js/adapter';

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
  readonly [key: string]: unknown;
}

export interface SatoriApiOptions {
  readonly baseUrl: string;
  readonly platform: string;
  readonly userId: string;
  readonly token?: string;
}

export interface SatoriWireSegment {
  readonly type: string;
  readonly data?: Record<string, unknown>;
}

/** Plugin Runtime owner config (`plugins.<instanceKey>` / schema.json). */
export interface SatoriAdapterConfig {
  readonly name?: string;
  readonly connection?: 'ws' | 'webhook';
  readonly baseUrl?: string;
  readonly token?: string;
  readonly heartbeat_interval?: number;
  /** Webhook POST path (connection: webhook). */
  readonly path?: string;
  /** Transitional: legacy root `endpoints[]` with `context: satori`. */
  readonly endpoints?: ReadonlyArray<Partial<ResolvedSatoriWsConfig> & {
    readonly context?: string;
    readonly connection?: 'ws' | 'webhook';
    readonly path?: string;
  }>;
}

export interface ResolvedSatoriWsConfig {
  readonly context: 'satori';
  readonly connection: 'ws';
  readonly name: string;
  readonly baseUrl: string;
  readonly token?: string;
  readonly heartbeat_interval: number;
}

export interface ResolvedSatoriWebhookConfig {
  readonly context: 'satori';
  readonly connection: 'webhook';
  readonly name: string;
  readonly baseUrl: string;
  readonly token?: string;
  readonly path: string;
}

export type ResolvedSatoriConfig = ResolvedSatoriWsConfig | ResolvedSatoriWebhookConfig;

export function resolveSatoriConfig(config: SatoriAdapterConfig = {}): ResolvedSatoriConfig {
  const entry = config.endpoints?.find((item) => item.context === 'satori');
  const connection = config.connection ?? entry?.connection ?? 'ws';
  const baseUrl = pickCredential(config.baseUrl, entry?.baseUrl, process.env.SATORI_BASE_URL);
  if (!baseUrl) {
    throw new TypeError(
      'Satori adapter requires baseUrl (plugins.<key>.baseUrl or endpoints with context: satori)',
    );
  }
  const name = (typeof config.name === 'string' && config.name)
    || (typeof entry?.name === 'string' && entry.name)
    || process.env.SATORI_BOT_NAME
    || 'satori-bot';
  const token = (typeof config.token === 'string' && config.token)
    || (typeof entry?.token === 'string' && entry.token)
    || process.env.SATORI_TOKEN
    || undefined;

  if (connection === 'webhook') {
    const path = config.path ?? entry?.path;
    if (!path) {
      throw new TypeError('Satori connection:webhook requires path');
    }
    return {
      context: 'satori',
      connection: 'webhook',
      name,
      baseUrl,
      token,
      path,
    };
  }

  const heartbeat = config.heartbeat_interval
    ?? entry?.heartbeat_interval
    ?? 10_000;
  return {
    context: 'satori',
    connection: 'ws',
    name,
    baseUrl,
    token,
    heartbeat_interval: heartbeat,
  };
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
export async function callSatoriApi<T = unknown>(
  options: SatoriApiOptions,
  resource: string,
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const { baseUrl, platform, userId, token } = options;
  const url = `${baseUrl.replace(/\/$/, '')}/v1/${resource}.${method}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Satori-Platform': platform,
    'Satori-User-ID': userId,
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  });

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

/** Build inbound text for MessageGateway.receive. */
export function formatInboundContent(body: SatoriEventBody & { message: SatoriMessage }): string {
  const content = body.message.content ?? '';
  return typeof content === 'string' ? content : String(content);
}

export function resolveInboundTarget(body: SatoriEventBody & { message: SatoriMessage }): string {
  const channel = body.channel ?? body.message.channel;
  return channel?.id ?? '';
}

export function resolveInboundSender(body: SatoriEventBody & { message: SatoriMessage }): string {
  const user = body.user ?? body.message.user ?? body.message.member?.user;
  return user?.name ?? body.message.member?.nick ?? user?.id ?? '';
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
        if (typeof data.url === 'string') parts.push(`[image:${data.url}]`);
        break;
      case 'file':
        if (typeof data.url === 'string') parts.push(`[file:${data.url}]`);
        break;
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
