/**
 * KOOK protocol helpers — no legacy Adapter/Endpoint / segment-mapper.
 * Canonicalization is owned by gateway/core before endpoint.send.
 */

import { createDecipheriv, timingSafeEqual } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import type { IncomingMessage } from 'node:http';
import { pickCredential } from '@zhin.js/adapter';

export type LogLevel =
  | 'trace'
  | 'debug'
  | 'info'
  | 'warn'
  | 'error'
  | 'fatal'
  | 'mark'
  | 'off';

export enum KookPermission {
  Normal = 1,
  Admin = 2,
  Owner = 4,
  ChannelAdmin = 5,
}

/** Plugin Runtime owner config (`plugins.<instanceKey>` / schema.json). */
export interface KookAdapterConfig {
  readonly name?: string;
  readonly token?: string;
  /** Default `websocket`. `webhook` requires httpHostToken + verify_token. */
  readonly connection?: 'websocket' | 'webhook';
  readonly webhookPath?: string;
  readonly verify_token?: string;
  readonly encrypt_key?: string;
  readonly data_dir?: string;
  readonly timeout?: number;
  readonly max_retry?: number;
  readonly ignore?: 'bot' | 'self';
  readonly logLevel?: LogLevel;
  /** Transitional: legacy root `endpoints[]` with `context: kook`. */
  readonly endpoints?: ReadonlyArray<{
    readonly context?: string;
    readonly name?: string;
    readonly token?: string;
    readonly connection?: 'websocket' | 'webhook';
    readonly webhookPath?: string;
    readonly verify_token?: string;
    readonly encrypt_key?: string;
    readonly data_dir?: string;
    readonly timeout?: number;
    readonly max_retry?: number;
    readonly ignore?: 'bot' | 'self';
    readonly logLevel?: LogLevel;
  }>;
}

export interface ResolvedKookWebsocketConfig {
  readonly context: 'kook';
  readonly connection: 'websocket';
  readonly name: string;
  readonly token: string;
  readonly data_dir?: string;
  readonly timeout: number;
  readonly max_retry: number;
  readonly ignore: 'bot' | 'self';
  readonly logLevel: LogLevel;
}

export interface ResolvedKookWebhookConfig {
  readonly context: 'kook';
  readonly connection: 'webhook';
  readonly name: string;
  readonly token: string;
  readonly webhookPath: string;
  readonly verifyToken: string;
  readonly encryptKey?: string;
  readonly ignore: 'bot' | 'self';
  readonly logLevel: LogLevel;
}

export interface KookWebhookEventData {
  readonly channel_type?: string;
  readonly type?: number;
  readonly target_id?: string;
  readonly author_id?: string;
  readonly content?: string;
  readonly msg_id?: string;
  readonly msg_timestamp?: number;
  readonly verify_token?: string;
  readonly challenge?: string;
  readonly extra?: {
    readonly guild_id?: string;
    readonly author?: {
      readonly id?: string;
      readonly username?: string;
      readonly bot?: boolean;
      readonly roles?: number[];
    };
  };
}

export interface KookWebhookFrame {
  readonly s?: number;
  readonly sn?: number;
  readonly d?: KookWebhookEventData;
  readonly encrypt?: string;
}

export type ResolvedKookConfig = ResolvedKookWebsocketConfig | ResolvedKookWebhookConfig;

export interface KookInboundMessage {
  readonly id: string;
  readonly content: string;
  readonly channelKind: 'private' | 'channel';
  readonly channelId: string;
  readonly authorId: string;
  readonly authorName: string;
  readonly authorBot?: boolean;
  readonly authorRoles?: number[];
  readonly timestamp: number;
  readonly guildId?: string;
  readonly rawMessage?: string;
}

export interface KookWireSegment {
  readonly type: string;
  readonly data?: Record<string, unknown>;
}

export interface ParsedSendTarget {
  readonly kind: 'private' | 'channel';
  readonly id: string;
}

export function resolveKookConfig(config: KookAdapterConfig = {}): ResolvedKookConfig {
  const entry = config.endpoints?.find((item) => item.context === 'kook' || !item.context);
  const token = pickCredential(config.token, entry?.token, process.env.KOOK_TOKEN, process.env.KOOK_BOT_TOKEN);
  if (!token) {
    throw new TypeError(
      'KOOK adapter requires token (plugins.<key>.token or endpoints with context: kook)',
    );
  }
  const name = (typeof config.name === 'string' && config.name)
    || (typeof entry?.name === 'string' && entry.name)
    || process.env.KOOK_BOT_NAME
    || 'kook-bot';
  const connection = config.connection
    ?? entry?.connection
    ?? 'websocket';

  if (connection === 'webhook') {
    const verifyToken = (typeof config.verify_token === 'string' && config.verify_token)
      || (typeof entry?.verify_token === 'string' && entry.verify_token)
      || process.env.KOOK_VERIFY_TOKEN
      || '';
    if (!verifyToken) {
      throw new TypeError(
        'KOOK webhook mode requires verify_token (plugins.<key>.verify_token or KOOK_VERIFY_TOKEN)',
      );
    }
    const encryptKey = config.encrypt_key ?? entry?.encrypt_key ?? process.env.KOOK_ENCRYPT_KEY;
    return {
      context: 'kook',
      connection: 'webhook',
      name,
      token,
      webhookPath: normalizeWebhookPath(
        config.webhookPath ?? entry?.webhookPath ?? process.env.KOOK_WEBHOOK_PATH ?? '/kook/webhook',
      ),
      verifyToken,
      encryptKey: typeof encryptKey === 'string' && encryptKey ? encryptKey : undefined,
      ignore: config.ignore ?? entry?.ignore ?? 'bot',
      logLevel: config.logLevel ?? entry?.logLevel ?? 'info',
    };
  }

  return {
    context: 'kook',
    connection: 'websocket',
    name,
    token,
    data_dir: config.data_dir ?? entry?.data_dir,
    timeout: config.timeout ?? entry?.timeout ?? 10_000,
    max_retry: config.max_retry ?? entry?.max_retry ?? 3,
    ignore: config.ignore ?? entry?.ignore ?? 'bot',
    logLevel: config.logLevel ?? entry?.logLevel ?? 'info',
  };
}

/**
 * Gateway reply target：`private:uid` / `channel:cid`，便于 send() 还原 API。
 */
export function formatInboundTarget(msg: KookInboundMessage): string {
  return `${msg.channelKind}:${msg.channelId}`;
}

export function parseSendTarget(target: string): ParsedSendTarget {
  const sep = target.indexOf(':');
  if (sep <= 0) {
    return { kind: 'channel', id: target };
  }
  const head = target.slice(0, sep);
  const rest = target.slice(sep + 1);
  if (head === 'private') return { kind: 'private', id: rest };
  if (head === 'channel' || head === 'group') return { kind: 'channel', id: rest };
  return { kind: 'channel', id: target };
}

export function senderDisplayName(msg: KookInboundMessage): string {
  return msg.authorName || msg.authorId;
}

/** Build inbound text for MessageGateway.receive */
export function formatInboundContent(msg: KookInboundMessage): string {
  const text = (msg.content || msg.rawMessage || '').trim();
  return text || '(Empty message)';
}

/**
 * KOOK @ 用户标记为 `(met)<userId>(met)`；content 含 `(met)<botId>(met)` 时视为 @ 机器人。
 * botId 取 client 缓存的 self_id（/me 类接口），拿不到则不标注。
 */
export function isKookBotMentioned(msg: KookInboundMessage, selfId?: string): boolean {
  if (!selfId) return false;
  const marker = `(met)${selfId}(met)`;
  return (msg.content || '').includes(marker) || (msg.rawMessage || '').includes(marker);
}

/**
 * Wire-encode an already-rendered outbound payload into KOOK KMarkdown.
 * Segment canonicalization is intentionally not done here.
 */
export function formatOutboundKmarkdown(payload: unknown): string {
  if (typeof payload === 'string') return payload;

  const segments: Array<string | KookWireSegment> = Array.isArray(payload)
    ? payload as Array<string | KookWireSegment>
    : payload && typeof payload === 'object' && 'type' in (payload as object)
      ? [payload as KookWireSegment]
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
          return id === 'all' ? '(met)all(met)' : `(met)${id}(met)`;
        }
        case 'image':
          return `![${String(data.alt || '图片')}](${String(data.url || data.file || '')})`;
        case 'face':
          return `(emj)${String(data.name || 'emoji')}(emj)[${String(data.id ?? '')}]`;
        case 'link':
          return `[${String(data.text || data.url || '')}](${String(data.url || '')})`;
        case 'video':
          return `[视频](${String(data.url || data.file || '')})`;
        case 'audio':
          return `[音频](${String(data.url || data.file || '')})`;
        case 'file':
          return `[文件: ${String(data.name || '未命名')}](${String(data.url || data.file || '')})`;
        case 'bold':
          return `**${String(data.text ?? '')}**`;
        case 'italic':
          return `*${String(data.text ?? '')}*`;
        case 'code':
          return `\`${String(data.text ?? '')}\``;
        case 'code_block':
          return `\`\`\`${String(data.language || '')}\n${String(data.text ?? '')}\n\`\`\``;
        case 'reply':
          return '';
        default:
          return data.text != null ? String(data.text) : '';
      }
    })
    .filter(Boolean)
    .join('');
}

export function normalizeWebhookPath(path: string): string {
  const trimmed = path.trim() || '/kook/webhook';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

export async function readTextBody(
  request: IncomingMessage,
  options: { readonly limit?: number } = {},
): Promise<string> {
  const limit = options.limit ?? 1_048_576;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) {
      request.destroy();
      throw new Error(`Request body exceeds ${limit} bytes`);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function readRequestBody(
  request: IncomingMessage,
  options: { readonly limit?: number } = {},
): Promise<Buffer> {
  const limit = options.limit ?? 1_048_576;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) {
      request.destroy();
      throw new Error(`Request body exceeds ${limit} bytes`);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export function padKookEncryptKey(key: string): Buffer {
  const buf = Buffer.alloc(32, 0);
  Buffer.from(key, 'utf8').copy(buf, 0, 0, Math.min(32, Buffer.byteLength(key, 'utf8')));
  return buf;
}

export function decryptKookWebhookPayload(encrypted: string, encryptKey: string): Buffer {
  const decoded = Buffer.from(encrypted, 'base64');
  const iv = decoded.subarray(0, 16);
  const ciphertext = decoded.subarray(16);
  const decipher = createDecipheriv('aes-256-cbc', padKookEncryptKey(encryptKey), iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function parseKookWebhookBody(rawBody: Buffer, encryptKey?: string): KookWebhookFrame {
  let text = rawBody.toString('utf8').trim();
  if (!text.startsWith('{')) {
    text = inflateSync(rawBody).toString('utf8');
  }
  let parsed: KookWebhookFrame;
  try {
    parsed = JSON.parse(text) as KookWebhookFrame;
  } catch {
    throw new TypeError('Invalid KOOK webhook JSON body');
  }
  if (parsed.encrypt) {
    if (!encryptKey) {
      throw new TypeError('KOOK webhook payload is encrypted but encrypt_key is not configured');
    }
    const decrypted = decryptKookWebhookPayload(parsed.encrypt, encryptKey);
    // 在字节层面判断：明文 JSON 以 '{' 开头，否则按 zlib 压缩数据处理。
    // 不能先 toString('utf8') 再转回 Buffer —— 压缩二进制会被替换字符损坏。
    let offset = 0;
    while (
      offset < decrypted.length
      && (decrypted[offset] === 0x20 || decrypted[offset] === 0x09
        || decrypted[offset] === 0x0a || decrypted[offset] === 0x0d)
    ) {
      offset += 1;
    }
    const decryptedText = decrypted[offset] === 0x7b // '{'
      ? decrypted.toString('utf8')
      : inflateSync(decrypted).toString('utf8');
    parsed = JSON.parse(decryptedText) as KookWebhookFrame;
  }
  return parsed;
}

export function isKookWebhookChallenge(event: KookWebhookEventData): boolean {
  return event.type === 255 && event.channel_type === 'WEBHOOK_CHALLENGE';
}

export function verifyKookWebhookToken(expected: string, actual?: string): boolean {
  if (!actual) return false;
  const left = Buffer.from(expected, 'utf8');
  const right = Buffer.from(actual, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function normalizeKookWebhookEvent(
  event: KookWebhookEventData,
  options: { readonly ignore?: 'bot' | 'self'; readonly selfId?: string } = {},
): KookInboundMessage | null {
  if (isKookWebhookChallenge(event)) return null;
  if (event.msg_id == null || event.author_id == null) return null;

  const authorBot = event.extra?.author?.bot === true;
  if (authorBot && options.ignore === 'bot') return null;
  if (options.selfId && String(event.author_id) === options.selfId && options.ignore === 'self') {
    return null;
  }

  const channelKind = event.channel_type === 'GROUP' ? 'channel' : 'private';
  const channelId = channelKind === 'channel'
    ? String(event.target_id ?? '')
    : String(event.author_id);
  if (!channelId) return null;

  return {
    id: String(event.msg_id),
    content: event.content ?? '',
    channelKind,
    channelId,
    authorId: String(event.author_id),
    authorName: event.extra?.author?.username
      || event.extra?.author?.id
      || String(event.author_id),
    authorBot,
    authorRoles: event.extra?.author?.roles,
    timestamp: event.msg_timestamp ?? Date.now(),
    guildId: event.extra?.guild_id,
  };
}
