/**
 * DingTalk protocol helpers — no legacy Adapter/Endpoint / segment-mapper.
 * Canonicalization is owned by gateway/core before endpoint.send.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

/** Plugin Runtime owner config (`plugins.<instanceKey>` / schema.json). */
export interface DingTalkAdapterConfig {
  readonly name?: string;
  readonly appKey?: string;
  readonly appSecret?: string;
  readonly webhookPath?: string;
  readonly robotCode?: string;
  readonly apiBaseUrl?: string;
  /** Transitional: legacy root `endpoints[]` with `context: dingtalk`. */
  readonly endpoints?: ReadonlyArray<Partial<ResolvedDingTalkConfig> & {
    readonly context?: string;
  }>;
}

export interface ResolvedDingTalkConfig {
  readonly context: 'dingtalk';
  readonly name: string;
  readonly appKey: string;
  readonly appSecret: string;
  readonly webhookPath: string;
  readonly robotCode?: string;
  readonly apiBaseUrl: string;
}

export interface DingTalkMessage {
  readonly msgtype?: string;
  readonly text?: { readonly content?: string };
  readonly msgId?: string;
  readonly createAt?: number;
  readonly conversationType?: string;
  readonly conversationId?: string;
  readonly senderId?: string;
  readonly senderNick?: string;
  readonly senderCorpId?: string;
  readonly sessionWebhook?: string;
  readonly chatbotCorpId?: string;
  readonly chatbotUserId?: string;
  readonly isAdmin?: boolean;
  readonly senderStaffId?: string;
  readonly atUsers?: ReadonlyArray<{ readonly dingtalkId?: string; readonly staffId?: string }>;
  readonly content?: Record<string, unknown>;
}

export interface DingTalkEvent extends DingTalkMessage {
  readonly [key: string]: unknown;
}

export interface AccessToken {
  token: string;
  expires_in: number;
  timestamp: number;
}

export interface DingTalkApiResponse {
  readonly errcode: number;
  readonly errmsg?: string;
  readonly access_token?: string;
  readonly expires_in?: number;
  readonly msgId?: string;
  readonly chatid?: string;
  readonly result?: unknown;
  readonly chat_info?: unknown;
  readonly [key: string]: unknown;
}

export interface DingTalkWireSegment {
  readonly type: string;
  readonly data?: Record<string, unknown>;
}

export interface DingTalkSendBody {
  readonly msgtype: string;
  readonly text?: { readonly content: string };
  readonly picture?: { readonly picURL: string };
  readonly markdown?: { readonly title: string; readonly text: string };
  readonly link?: {
    readonly title: string;
    readonly text: string;
    readonly messageUrl?: string;
    readonly picUrl?: string;
  };
  readonly at?: { readonly atUserIds: string[]; readonly isAtAll: boolean };
  readonly robotCode?: string;
}

export function resolveDingTalkConfig(config: DingTalkAdapterConfig = {}): ResolvedDingTalkConfig {
  const entry = config.endpoints?.find((item) => item.context === 'dingtalk');
  const appKey = config.appKey ?? entry?.appKey ?? process.env.DINGTALK_APP_KEY;
  const appSecret = config.appSecret ?? entry?.appSecret ?? process.env.DINGTALK_APP_SECRET;
  if (!appKey || !appSecret) {
    throw new TypeError(
      'DingTalk adapter requires appKey + appSecret (plugins.<key> or endpoints with context: dingtalk)',
    );
  }
  const name = (typeof config.name === 'string' && config.name)
    || (typeof entry?.name === 'string' && entry.name)
    || process.env.DINGTALK_BOT_NAME
    || 'dingtalk-bot';
  const webhookPath = normalizeWebhookPath(
    config.webhookPath ?? entry?.webhookPath ?? '/dingtalk/webhook',
  );
  const apiBaseUrl = (
    config.apiBaseUrl ?? entry?.apiBaseUrl ?? 'https://oapi.dingtalk.com'
  ).replace(/\/$/, '');
  const robotCode = config.robotCode ?? entry?.robotCode;
  return {
    context: 'dingtalk',
    name,
    appKey,
    appSecret,
    webhookPath,
    ...(robotCode ? { robotCode } : {}),
    apiBaseUrl,
  };
}

export function normalizeWebhookPath(path: string): string {
  const trimmed = path.trim() || '/dingtalk/webhook';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

export function resolveChatType(conversationType?: string): 'group' | 'private' {
  return conversationType === '2' ? 'group' : 'private';
}

export function resolveTarget(msg: DingTalkMessage): string {
  return msg.conversationId || msg.senderId || 'unknown';
}

export function resolveSender(msg: DingTalkMessage): string {
  return msg.senderId || msg.senderStaffId || 'unknown';
}

export function generateMessageId(msg: DingTalkMessage): string {
  return msg.msgId || `${msg.createAt ?? Date.now()}`;
}

/** Build inbound text for MessageGateway.receive. */
export function formatInboundContent(msg: DingTalkMessage): string {
  if (!msg.msgtype) return '';
  switch (msg.msgtype) {
    case 'text':
      return msg.text?.content || '';
    case 'picture':
      return '[image]';
    case 'file': {
      const name = typeof msg.content?.fileName === 'string' ? msg.content.fileName : '';
      return name ? `[file: ${name}]` : '[file]';
    }
    case 'audio':
      return '[audio]';
    case 'video':
      return '[video]';
    case 'richText': {
      const rich = msg.content?.richText;
      if (Array.isArray(rich)) {
        return rich
          .map((item) => (item && typeof item === 'object' && 'text' in item
            ? String((item as { text?: string }).text || '')
            : ''))
          .join('');
      }
      return '[richText]';
    }
    case 'markdown':
      return typeof msg.content?.text === 'string' ? msg.content.text : '[markdown]';
    default:
      return `[${msg.msgtype}]`;
  }
}

export function verifySignature(
  appSecret: string,
  timestamp: string,
  sign: string,
): boolean {
  try {
    const stringToSign = `${timestamp}\n${appSecret}`;
    const hmac = createHmac('sha256', appSecret);
    hmac.update(stringToSign);
    const calculated = hmac.digest('base64');
    const a = Buffer.from(calculated);
    const b = Buffer.from(sign);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Wire-encode an already-rendered outbound payload into DingTalk robot body.
 * Segment canonicalization is intentionally not done here.
 */
export function formatOutboundBody(payload: unknown): DingTalkSendBody {
  if (typeof payload === 'string') {
    return { msgtype: 'text', text: { content: payload } };
  }

  const items: Array<string | DingTalkWireSegment> = Array.isArray(payload)
    ? payload as Array<string | DingTalkWireSegment>
    : payload && typeof payload === 'object' && 'type' in (payload as object)
      ? [payload as DingTalkWireSegment]
      : [];

  if (items.length === 0) {
    const text = payload == null
      ? ''
      : typeof payload === 'object'
        ? JSON.stringify(payload)
        : String(payload);
    return { msgtype: 'text', text: { content: text } };
  }

  const textParts: string[] = [];
  const atUserIds: string[] = [];
  let media: DingTalkSendBody | null = null;

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
      case 'at': {
        const userId = data.id ?? data.userId;
        if (userId) {
          atUserIds.push(String(userId));
          textParts.push(`@${String(data.name || userId)} `);
        }
        break;
      }
      case 'image':
        if (!media) {
          media = {
            msgtype: 'picture',
            picture: { picURL: String(data.url ?? data.file ?? '') },
          };
        }
        break;
      case 'markdown':
        if (!media) {
          media = {
            msgtype: 'markdown',
            markdown: {
              title: String(data.title || '消息'),
              text: String(data.content ?? data.text ?? ''),
            },
          };
        }
        break;
      case 'link':
        if (!media) {
          media = {
            msgtype: 'link',
            link: {
              title: String(data.title || '链接'),
              text: String(data.text ?? data.content ?? ''),
              messageUrl: typeof data.url === 'string' ? data.url : undefined,
              picUrl: typeof data.picUrl === 'string' ? data.picUrl : undefined,
            },
          };
        }
        break;
      default:
        textParts.push(`[${item.type}]`);
    }
  }

  if (media) return media;

  const result: DingTalkSendBody = {
    msgtype: 'text',
    text: { content: textParts.join('') },
  };
  if (atUserIds.length > 0) {
    return { ...result, at: { atUserIds, isAtAll: false } };
  }
  return result;
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
