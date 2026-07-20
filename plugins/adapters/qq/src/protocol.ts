/**
 * QQ Official Bot protocol helpers — no legacy Adapter/Endpoint / segment-mapper.
 * Canonicalization is owned by gateway/core before endpoint.send.
 */

import { pickCredential } from '@zhin.js/adapter';

/** Plugin Runtime owner config (`plugins.<instanceKey>` / schema.json). */
export interface QqAdapterConfig {
  readonly name?: string;
  readonly appid?: string;
  readonly secret?: string;
  /** Default `websocket`. `webhook` / `middleware` use httpHostToken POST. */
  readonly mode?: 'websocket' | 'webhook' | 'middleware';
  readonly sandbox?: boolean;
  readonly intents?: readonly string[];
  readonly accessTokenUrl?: string;
  readonly gatewayUrl?: string;
  readonly webhookPath?: string;
  readonly port?: number;
  readonly path?: string;
  /** Transitional: legacy root `endpoints[]` with `context: qq`. */
  readonly endpoints?: ReadonlyArray<{
    readonly context?: string;
    readonly name?: string;
    readonly appid?: string;
    readonly secret?: string;
    readonly mode?: 'websocket' | 'webhook' | 'middleware';
    readonly sandbox?: boolean;
    readonly intents?: readonly string[];
    readonly accessTokenUrl?: string;
    readonly gatewayUrl?: string;
    readonly webhookPath?: string;
    readonly port?: number;
    readonly path?: string;
  }>;
}

export interface ResolvedQqWebsocketConfig {
  readonly context: 'qq';
  readonly mode: 'websocket';
  readonly name: string;
  readonly appid: string;
  readonly secret: string;
  readonly sandbox: boolean;
  readonly intents?: readonly string[];
  readonly accessTokenUrl?: string;
  readonly gatewayUrl?: string;
}

export interface ResolvedQqHttpConfig {
  readonly context: 'qq';
  readonly mode: 'webhook' | 'middleware';
  readonly name: string;
  readonly appid: string;
  readonly secret: string;
  readonly webhookPath: string;
  readonly sandbox: boolean;
}

export type ResolvedQqConfig = ResolvedQqWebsocketConfig | ResolvedQqHttpConfig;

export type QqChannelKind = 'private' | 'group' | 'channel' | 'direct';

export interface QqInboundMessage {
  readonly id: string;
  readonly content: string;
  readonly channelKind: QqChannelKind;
  readonly channelId: string;
  readonly authorId: string;
  readonly authorName: string;
  readonly authorRoles?: string[];
  readonly timestamp: number;
  readonly guildId?: string;
  readonly rawMessage?: string;
}

export interface QqWireSegment {
  readonly type: string;
  readonly data?: Record<string, unknown>;
}

export interface ParsedSendTarget {
  readonly kind: QqChannelKind;
  readonly id: string;
}

export function resolveQqConfig(config: QqAdapterConfig = {}): ResolvedQqConfig {
  const entry = config.endpoints?.find((item) => item.context === 'qq' || !item.context);
  const appid = pickCredential(config.appid, entry?.appid, process.env.QQ_APPID, process.env.QQ_BOT_APPID);
  const secret = pickCredential(config.secret, entry?.secret, process.env.QQ_SECRET, process.env.QQ_BOT_SECRET);
  if (!appid || !secret) {
    throw new TypeError(
      'QQ adapter requires appid + secret (plugins.<key>.appid/secret or endpoints with context: qq)',
    );
  }
  const name = (typeof config.name === 'string' && config.name)
    || (typeof entry?.name === 'string' && entry.name)
    || process.env.QQ_BOT_NAME
    || 'qq-bot';
  const mode = config.mode ?? entry?.mode ?? 'websocket';

  if (mode === 'webhook' || mode === 'middleware') {
    const webhookPathRaw = config.webhookPath ?? entry?.webhookPath ?? '/qq/webhook';
    const webhookPath = webhookPathRaw.startsWith('/') ? webhookPathRaw : `/${webhookPathRaw}`;
    return {
      context: 'qq',
      mode,
      name,
      appid,
      secret,
      webhookPath,
      sandbox: config.sandbox === true || entry?.sandbox === true,
    };
  }

  return {
    context: 'qq',
    mode: 'websocket',
    name,
    appid,
    secret,
    sandbox: config.sandbox === true || entry?.sandbox === true,
    intents: config.intents ?? entry?.intents,
    accessTokenUrl: config.accessTokenUrl ?? entry?.accessTokenUrl,
    gatewayUrl: config.gatewayUrl ?? entry?.gatewayUrl,
  };
}

/**
 * Gateway reply target：`private:uid` / `group:gid` / `channel:cid` / `direct:guildId`.
 */
export function formatInboundTarget(msg: QqInboundMessage): string {
  return `${msg.channelKind}:${msg.channelId}`;
}

export function parseSendTarget(target: string): ParsedSendTarget {
  const sep = target.indexOf(':');
  if (sep <= 0) {
    return { kind: 'private', id: target };
  }
  const head = target.slice(0, sep);
  const rest = target.slice(sep + 1);
  if (head === 'private' || head === 'group' || head === 'channel' || head === 'direct') {
    return { kind: head, id: rest };
  }
  return { kind: 'private', id: target };
}

export function senderDisplayName(msg: QqInboundMessage): string {
  return msg.authorName || msg.authorId;
}

export function formatInboundContent(msg: QqInboundMessage): string {
  const text = (msg.content || msg.rawMessage || '').trim();
  return text || '(Empty message)';
}

/**
 * Wire-encode an already-rendered outbound payload into a plain text / QQ Sendable string.
 * Segment canonicalization is intentionally not done here.
 */
export function formatOutboundText(payload: unknown): string {
  if (typeof payload === 'string') return payload;

  const segments: Array<string | QqWireSegment> = Array.isArray(payload)
    ? payload as Array<string | QqWireSegment>
    : payload && typeof payload === 'object' && 'type' in (payload as object)
      ? [payload as QqWireSegment]
      : [];

  if (segments.length === 0) {
    return payload == null
      ? ''
      : typeof payload === 'object'
        ? JSON.stringify(payload)
        : String(payload);
  }

  return segments
    .map((item) => {
      if (typeof item === 'string') return item;
      const data = item.data ?? {};
      switch (item.type) {
        case 'text':
          return String(data.text ?? data.content ?? '');
        case 'at': {
          const id = String(data.user_id ?? data.qq ?? data.id ?? '');
          return id ? `<@!${id}>` : '';
        }
        case 'image':
          return String(data.url || data.file || '');
        case 'reply':
          return '';
        default:
          return data.text != null ? String(data.text) : '';
      }
    })
    .filter(Boolean)
    .join('');
}

/** 从 QQ API SendResult / 审核回包中解析出站消息 ID */
export function resolveOutboundMessageId(result: unknown): string {
  if (!result || typeof result !== 'object') {
    throw new Error('QQ 发送消息失败：响应为空');
  }
  const row = result as Record<string, unknown>;
  const nested = row.data && typeof row.data === 'object'
    ? row.data as Record<string, unknown>
    : undefined;
  const audit = (row.message_audit ?? nested?.message_audit) as Record<string, unknown> | undefined;
  const id = row.id ?? row.message_id ?? audit?.audit_id;
  if (id == null || id === '') {
    const code = row.code;
    const msg = row.message;
    throw new Error(
      code != null
        ? `QQ 发送消息失败（${String(code)}）${msg ? `: ${String(msg)}` : ''}`
        : 'QQ 发送消息失败：响应缺少消息 ID',
    );
  }
  return String(id);
}
