/**
 * Lark/Feishu protocol helpers — no legacy Adapter/Endpoint / segment-mapper.
 * Canonicalization is owned by gateway/core before endpoint.send.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

/** Plugin Runtime owner config (`plugins.<instanceKey>` / schema.json). */
export interface LarkAdapterConfig {
  readonly name?: string;
  readonly appId?: string;
  readonly appSecret?: string;
  readonly encryptKey?: string;
  readonly verificationToken?: string;
  readonly webhookPath?: string;
  readonly apiBaseUrl?: string;
  readonly isFeishu?: boolean;
  /** Transitional: legacy root `endpoints[]` with `context: lark`. */
  readonly endpoints?: ReadonlyArray<Partial<ResolvedLarkConfig> & {
    readonly context?: string;
  }>;
}

export interface ResolvedLarkConfig {
  readonly context: 'lark';
  readonly name: string;
  readonly appId: string;
  readonly appSecret: string;
  readonly encryptKey?: string;
  readonly verificationToken?: string;
  readonly webhookPath: string;
  readonly apiBaseUrl: string;
  readonly isFeishu: boolean;
}

export interface LarkMessage {
  readonly message_id?: string;
  readonly root_id?: string;
  readonly parent_id?: string;
  readonly create_time?: string;
  readonly update_time?: string;
  readonly chat_id?: string;
  readonly sender?: {
    readonly sender_id?: {
      readonly user_id?: string;
      readonly open_id?: string;
      readonly union_id?: string;
    };
    readonly sender_type?: string;
    readonly tenant_key?: string;
  };
  readonly message_type?: string;
  readonly content?: string;
  readonly mentions?: ReadonlyArray<{
    readonly key?: string;
    readonly id?: {
      readonly user_id?: string;
      readonly open_id?: string;
      readonly union_id?: string;
    };
    readonly name?: string;
    readonly tenant_key?: string;
  }>;
}

export interface LarkEventBody {
  readonly uuid?: string;
  readonly token?: string;
  readonly ts?: string;
  readonly type?: string;
  readonly challenge?: string;
  readonly event?: {
    readonly sender?: LarkMessage['sender'];
    readonly message?: LarkMessage;
    readonly [key: string]: unknown;
  };
}

export interface AccessToken {
  token: string;
  expires_in: number;
  timestamp: number;
}

export interface LarkApiResponse {
  readonly code: number;
  readonly msg?: string;
  readonly tenant_access_token?: string;
  readonly expire?: number;
  readonly data?: Record<string, unknown>;
  readonly [key: string]: unknown;
}

export interface LarkWireSegment {
  readonly type: string;
  readonly data?: Record<string, unknown>;
}

export interface LarkSendBody {
  readonly msg_type: string;
  readonly content: string;
}

export function resolveLarkConfig(config: LarkAdapterConfig = {}): ResolvedLarkConfig {
  const entry = config.endpoints?.find((item) => item.context === 'lark');
  const appId = config.appId ?? entry?.appId ?? process.env.LARK_APP_ID;
  const appSecret = config.appSecret ?? entry?.appSecret ?? process.env.LARK_APP_SECRET;
  if (!appId || !appSecret) {
    throw new TypeError(
      'Lark adapter requires appId + appSecret (plugins.<key> or endpoints with context: lark)',
    );
  }
  const isFeishu = config.isFeishu ?? entry?.isFeishu ?? true;
  const name = (typeof config.name === 'string' && config.name)
    || (typeof entry?.name === 'string' && entry.name)
    || process.env.LARK_BOT_NAME
    || 'lark-bot';
  const webhookPath = normalizeWebhookPath(
    config.webhookPath ?? entry?.webhookPath ?? '/lark/webhook',
  );
  const defaultBase = isFeishu
    ? 'https://open.feishu.cn/open-apis'
    : 'https://open.larksuite.com/open-apis';
  const apiBaseUrl = (
    config.apiBaseUrl ?? entry?.apiBaseUrl ?? defaultBase
  ).replace(/\/$/, '');
  const encryptKey = config.encryptKey ?? entry?.encryptKey;
  const verificationToken = config.verificationToken ?? entry?.verificationToken;
  return {
    context: 'lark',
    name,
    appId,
    appSecret,
    ...(encryptKey ? { encryptKey } : {}),
    ...(verificationToken ? { verificationToken } : {}),
    webhookPath,
    apiBaseUrl,
    isFeishu,
  };
}

export function normalizeWebhookPath(path: string): string {
  const trimmed = path.trim() || '/lark/webhook';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

export function resolveChatType(chatId?: string): 'group' | 'private' {
  return chatId?.startsWith('oc_') ? 'group' : 'private';
}

export function resolveTarget(msg: LarkMessage): string {
  return msg.chat_id || 'unknown';
}

export function resolveSender(msg: LarkMessage): string {
  return msg.sender?.sender_id?.open_id
    || msg.sender?.sender_id?.user_id
    || 'unknown';
}

export function generateMessageId(msg: LarkMessage): string {
  return msg.message_id || `${msg.create_time ?? Date.now()}`;
}

/** Build inbound text for MessageGateway.receive. */
export function formatInboundContent(msg: LarkMessage): string {
  if (!msg.content || !msg.message_type) return '';
  try {
    const parsed = JSON.parse(msg.content) as Record<string, unknown>;
    switch (msg.message_type) {
      case 'text':
        return typeof parsed.text === 'string' ? parsed.text : '';
      case 'image':
        return '[image]';
      case 'file': {
        const name = typeof parsed.file_name === 'string' ? parsed.file_name : '';
        return name ? `[file: ${name}]` : '[file]';
      }
      case 'audio':
        return '[audio]';
      case 'video':
        return '[video]';
      case 'sticker':
        return '[sticker]';
      case 'post':
      case 'interactive':
        return `[${msg.message_type}]`;
      case 'rich_text':
        return '[rich_text]';
      default:
        return `[${msg.message_type}]`;
    }
  } catch {
    return '[消息解析失败]';
  }
}

export function verifySignature(
  encryptKey: string,
  timestamp: string,
  nonce: string,
  body: string,
  signature: string,
): boolean {
  try {
    const stringToSign = `${timestamp}${nonce}${encryptKey}${body}`;
    const calculated = createHash('sha256').update(stringToSign).digest('hex');
    const a = Buffer.from(calculated);
    const b = Buffer.from(signature);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Wire-encode an already-rendered outbound payload into Lark im/v1 message body.
 * Segment canonicalization is intentionally not done here.
 */
export function formatOutboundBody(payload: unknown): LarkSendBody {
  if (typeof payload === 'string') {
    return {
      msg_type: 'text',
      content: JSON.stringify({ text: payload }),
    };
  }

  const items: Array<string | LarkWireSegment> = Array.isArray(payload)
    ? payload as Array<string | LarkWireSegment>
    : payload && typeof payload === 'object' && 'type' in (payload as object)
      ? [payload as LarkWireSegment]
      : [];

  if (items.length === 0) {
    const text = payload == null
      ? ''
      : typeof payload === 'object'
        ? JSON.stringify(payload)
        : String(payload);
    return {
      msg_type: 'text',
      content: JSON.stringify({ text }),
    };
  }

  const textParts: string[] = [];
  let media: LarkSendBody | null = null;

  for (const item of items) {
    if (typeof item === 'string') {
      textParts.push(item);
      continue;
    }
    const data = item.data ?? {};
    switch (item.type) {
      case 'text':
        textParts.push(String(data.content ?? data.text ?? ''));
        break;
      case 'at':
        textParts.push(
          `<at user_id="${String(data.id ?? '')}">${String(data.name || data.id || '')}</at>`,
        );
        break;
      case 'image':
        if (!media) {
          media = {
            msg_type: 'image',
            content: JSON.stringify({
              image_key: data.file_key ?? data.key ?? data.url,
            }),
          };
        }
        break;
      case 'file':
        if (!media) {
          media = {
            msg_type: 'file',
            content: JSON.stringify({
              file_key: data.file_key ?? data.key,
            }),
          };
        }
        break;
      case 'card':
        if (!media) {
          media = {
            msg_type: 'interactive',
            content: JSON.stringify(data),
          };
        }
        break;
      default:
        textParts.push(`[${item.type}]`);
    }
  }

  if (media) return media;
  return {
    msg_type: 'text',
    content: JSON.stringify({ text: textParts.join('') }),
  };
}

export function headerValue(
  headers: IncomingMessage['headers'],
  name: string,
): string {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
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
