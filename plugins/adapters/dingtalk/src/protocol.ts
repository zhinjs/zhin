/**
 * DingTalk protocol helpers — no legacy Adapter/Endpoint / segment-mapper.
 * Canonicalization is owned by gateway/core before endpoint.send.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

import { EndpointDeliveryError, isMediaRef, type ConversationRef } from '@zhin.js/im-contract';

/** One endpoint config after AdapterIndex expands `plugins.<instanceKey>.endpoints`. */
export interface DingTalkEndpointConfig {
  readonly streamProxy?: import('./stream-proxy.js').DingTalkStreamProxy;
  readonly id: string;
  readonly appKey: string;
  readonly appSecret: string;
  readonly mode?: 'webhook' | 'stream';
  readonly webhookPath?: string;
  readonly robotCode?: string;
  readonly apiBaseUrl?: string;
  readonly cardTemplateId?: string;
  readonly cardButtonCount?: number;
}

export interface ResolvedDingTalkConfig {
  readonly streamProxy?: import('./stream-proxy.js').DingTalkStreamProxy;
  readonly context: 'dingtalk';
  readonly mode?: 'webhook' | 'stream';
  readonly id: string;
  readonly appKey: string;
  readonly appSecret: string;
  readonly webhookPath: string;
  readonly robotCode?: string;
  readonly apiBaseUrl: string;
  readonly cardTemplateId?: string;
  readonly cardButtonCount?: number;
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
  readonly sessionWebhookExpiredTime?: number;
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

/**
 * 钉钉回调消息 @ 机器人判定：机器人被 @ 时回调带 `isInAtList: true`；
 * 部分回调形态的 `atUserIds` / `atUsers[].dingtalkId` 会包含机器人 robotCode（来自配置）。
 * 两者都不满足则不标注。
 */
export function isDingtalkBotMentioned(event: DingTalkMessage, robotCode?: string): boolean {
  const extra = event as DingTalkMessage & {
    readonly isInAtList?: unknown;
    readonly atUserIds?: unknown;
  };
  if (extra.isInAtList === true) return true;
  if (!robotCode) return false;
  if (Array.isArray(extra.atUserIds) && extra.atUserIds.some((id) => String(id) === robotCode)) {
    return true;
  }
  return (event.atUsers ?? []).some((user) => user.dingtalkId === robotCode);
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

export function resolveDingTalkConfig(config: DingTalkEndpointConfig): ResolvedDingTalkConfig {
  if (config.streamProxy && (!Number.isInteger(config.streamProxy.port) || config.streamProxy.port < 1 || config.streamProxy.port > 65535
    || typeof config.streamProxy.serverName !== 'string' || !config.streamProxy.serverName || /[\s/:@?#]/.test(config.streamProxy.serverName))) throw new TypeError('Invalid DingTalk streamProxy port/serverName');
  if (config.mode !== undefined && !['webhook', 'stream'].includes(config.mode)) throw new TypeError('Invalid DingTalk mode');
  const id = requiredEndpointField(config.id, 'id');
  const appKey = requiredEndpointField(config.appKey, 'appKey');
  const appSecret = requiredEndpointField(config.appSecret, 'appSecret');
  const webhookPath = normalizeWebhookPath(config.webhookPath ?? '/dingtalk/webhook');
  const apiBaseUrl = (config.apiBaseUrl ?? 'https://oapi.dingtalk.com').replace(/\/$/, '');
  const robotCode = config.robotCode;
  if (config.cardButtonCount !== undefined && (!Number.isInteger(config.cardButtonCount) || config.cardButtonCount < 1 || config.cardButtonCount > 5)) throw new TypeError('cardButtonCount must be 1..5');
  return {
    ...(config.streamProxy ? { streamProxy: config.streamProxy } : {}),
    context: 'dingtalk',
    mode: config.mode ?? 'webhook',
    id,
    appKey,
    appSecret,
    webhookPath,
    ...(robotCode ? { robotCode } : {}),
    apiBaseUrl,
    ...(config.cardTemplateId ? { cardTemplateId: config.cardTemplateId } : {}),
    cardButtonCount: config.cardButtonCount ?? 2,
  };
}

function requiredEndpointField(
  value: unknown,
  field: 'id' | 'appKey' | 'appSecret',
): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`DingTalk endpoint requires a non-empty ${field}`);
  }
  return value.trim();
}

export function normalizeWebhookPath(path: string): string {
  const trimmed = path.trim() || '/dingtalk/webhook';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

export function resolveChatType(conversationType?: string): 'group' | 'private' {
  return conversationType === '2' ? 'group' : 'private';
}

/**
 * 入站归一化 → ConversationRef：`conversationType: '2'` 为群会话（kind 'group'），
 * 其余为单聊（kind 'private'）；会话原生 id 取 conversationId，缺省回退 senderId。
 * 钉钉无 guild/频道容器概念，不产生 parent。
 */
export function dingtalkInboundConversation(endpointKey: string, msg: DingTalkMessage): ConversationRef {
  return {
    endpoint: { id: endpointKey, adapter: endpointKey.split('\0')[0] ?? endpointKey },
    kind: resolveChatType(msg.conversationType),
    id: msg.conversationId || msg.senderId || 'unknown',
  };
}

export function resolveSender(msg: DingTalkMessage): string {
  return msg.senderId || msg.senderStaffId || 'unknown';
}

export function generateMessageId(msg: DingTalkMessage): string {
  return msg.msgId || `${msg.createAt ?? Date.now()}`;
}

/** Build inbound text for OutboundMessageService.receive. */
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

/** DingTalk timestamps are epoch milliseconds; reject replays outside ±1 hour. */
export const MAX_TIMESTAMP_DRIFT_MS = 60 * 60 * 1000;

export function verifySignature(
  appSecret: string,
  timestamp: string,
  sign: string,
): boolean {
  try {
    const ts = Number(timestamp);
    if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > MAX_TIMESTAMP_DRIFT_MS) {
      return false;
    }
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
 * Segment canonicalization is intentionally not done here: media segments carry
 * the canonical `data.media` MediaRef and nothing else is consulted.
 *
 * 钉钉机器人图片使用官方 Markdown HTTP(S) 图片链接，保留同载荷文本和图片顺序。
 * 本地媒体上传、原生引用、音频/视频/文件未接线，在请求前明确拒绝。
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
  let markdownTitle: string | undefined;

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
      case 'reply':
        throw new EndpointDeliveryError('unsupported_operation', 'DingTalk native quoted replies are not implemented', 'not_sent');
      case 'share': {
        if (['audio', 'artist', 'duration', 'config'].some(key => data[key] !== undefined)) {
          throw new EndpointDeliveryError('unsupported_operation', 'dingtalk rich share metadata is not implemented', 'not_sent');
        }
        let url: URL;
        try { url = new URL(String(data.url ?? '')); } catch { throw new EndpointDeliveryError('invalid_payload', 'DingTalk share requires an HTTP(S) URL', 'not_sent'); }
        if (!['https:', 'http:'].includes(url.protocol)) throw new EndpointDeliveryError('invalid_payload', 'DingTalk share requires an HTTP(S) URL', 'not_sent');
        if (media) throw new EndpointDeliveryError('invalid_payload', 'DingTalk accepts one link card per message', 'not_sent');
        media = { msgtype: 'link', link: { title: String(data.title ?? '链接'), text: String(data.description ?? data.content ?? ''), messageUrl: url.toString(), ...(typeof data.image === 'string' ? { picUrl: data.image } : {}) } };
        break;
      }
      case 'keyboard':
        throw new EndpointDeliveryError('unsupported_operation', 'DingTalk native keyboard callback requires an interactive card template and is not implemented', 'not_sent');
      case 'image': {
        const ref = data.media;
        if (isMediaRef(ref) && ref.kind === 'url') {
          let url: URL;
          try { url = new URL(ref.value); } catch { throw new EndpointDeliveryError('invalid_payload', 'DingTalk image requires an HTTP(S) URL', 'not_sent'); }
          if (!['https:', 'http:'].includes(url.protocol)) throw new EndpointDeliveryError('invalid_payload', 'DingTalk image requires an HTTP(S) URL', 'not_sent');
          markdownTitle ??= '消息';
          textParts.push(`\n![](${ref.value.replace(/[()\s]/g, character => encodeURIComponent(character))})\n`);
          break;
        }
        throw new EndpointDeliveryError('unsupported_operation', 'DingTalk image upload is not implemented; use a canonical HTTP(S) URL', 'not_sent');
      }
      case 'audio':
      case 'video':
      case 'file':
        throw new EndpointDeliveryError('unsupported_operation', 'DingTalk audio/video/file delivery is not implemented', 'not_sent');
      case 'markdown':
        markdownTitle ??= String(data.title || '消息');
        textParts.push(String(data.content ?? data.text ?? ''));
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

  if (media) return media.link && textParts.length ? { ...media, link: { ...media.link, text: [...textParts, media.link.text].filter(Boolean).join('\n') } } : media;
  if (markdownTitle !== undefined) {
    return {
      msgtype: 'markdown',
      markdown: { title: markdownTitle, text: textParts.join('') },
      ...(atUserIds.length > 0 ? { at: { atUserIds, isAtAll: false } } : {}),
    };
  }

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
