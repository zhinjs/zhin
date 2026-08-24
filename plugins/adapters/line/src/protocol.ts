/**
 * LINE Messaging API protocol helpers — no legacy Adapter/Endpoint / segment-mapper.
 * Canonicalization is owned by gateway/core before endpoint.send.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { isMediaRef } from '@zhin.js/core';
import type { ConversationRef } from '@zhin.js/im-contract';
import { formatCompact, getLogger } from '@zhin.js/logger';

const logger = getLogger('line');

/** Plugin Runtime owner config (`plugins.<instanceKey>` / schema.json). */
export interface LineAdapterConfig {
  readonly id?: string;
  readonly channelSecret?: string;
  readonly channelAccessToken?: string;
  readonly webhookPath?: string;
  readonly apiBaseUrl?: string;
  /** Transitional: legacy root `endpoints[]` with `context: line`. */
  readonly endpoints?: ReadonlyArray<Partial<ResolvedLineConfig> & {
    readonly context?: string;
  }>;
}

export interface ResolvedLineConfig {
  readonly context: 'line';
  readonly id: string;
  readonly channelSecret: string;
  readonly channelAccessToken: string;
  readonly webhookPath: string;
  readonly apiBaseUrl: string;
}

export interface LineUser {
  readonly userId: string;
  readonly displayName?: string;
  readonly pictureUrl?: string;
  readonly statusMessage?: string;
}

export interface LineMessageEvent {
  readonly type: 'message';
  readonly replyToken: string;
  readonly source: LineSource;
  readonly timestamp: number;
  readonly message: LineMessage;
}

export interface LineFollowEvent {
  readonly type: 'follow';
  readonly replyToken: string;
  readonly source: LineSource;
  readonly timestamp: number;
}

export interface LineUnfollowEvent {
  readonly type: 'unfollow';
  readonly source: LineSource;
  readonly timestamp: number;
}

export interface LineJoinEvent {
  readonly type: 'join';
  readonly replyToken: string;
  readonly source: LineSource;
  readonly timestamp: number;
}

export interface LineLeaveEvent {
  readonly type: 'leave';
  readonly source: LineSource;
  readonly timestamp: number;
}

export interface LinePostbackEvent {
  readonly type: 'postback';
  readonly replyToken: string;
  readonly source: LineSource;
  readonly timestamp: number;
  readonly postback: {
    readonly data: string;
    readonly params?: Record<string, string>;
  };
}

export type LineEvent =
  | LineMessageEvent
  | LineFollowEvent
  | LineUnfollowEvent
  | LineJoinEvent
  | LineLeaveEvent
  | LinePostbackEvent;

export interface LineSource {
  readonly type: 'user' | 'group' | 'room';
  readonly userId?: string;
  readonly groupId?: string;
  readonly roomId?: string;
}

export interface LineMessage {
  readonly id: string;
  readonly type: 'text' | 'image' | 'video' | 'audio' | 'file' | 'location' | 'sticker';
  readonly text?: string;
  readonly fileName?: string;
  readonly fileSize?: number;
  readonly title?: string;
  readonly address?: string;
  readonly latitude?: number;
  readonly longitude?: number;
  readonly packageId?: string;
  readonly stickerId?: string;
  readonly stickerResourceType?: string;
  readonly duration?: number;
}

export interface LineWebhookBody {
  readonly destination: string;
  readonly events: readonly LineEvent[];
}

export interface LineReplyMessage {
  readonly type: 'text' | 'image' | 'video' | 'audio' | 'location' | 'sticker' | 'flex';
  readonly text?: string;
  readonly originalContentUrl?: string;
  readonly previewImageUrl?: string;
  readonly packageId?: string;
  readonly stickerId?: string;
  readonly title?: string;
  readonly address?: string;
  readonly latitude?: number;
  readonly longitude?: number;
  readonly duration?: number;
  readonly altText?: string;
  readonly contents?: Record<string, unknown>;
}

export interface LineReplyRequest {
  readonly replyToken: string;
  readonly messages: readonly LineReplyMessage[];
}

export interface LinePushRequest {
  readonly to: string;
  readonly messages: readonly LineReplyMessage[];
}

export interface LineApiResponse {
  readonly sentMessages?: ReadonlyArray<{ readonly id: string; readonly quoteToken?: string }>;
}

export interface LineWireSegment {
  readonly type: string;
  readonly data?: Record<string, unknown>;
}

export interface LineChannel {
  readonly channelType: 'private' | 'group' | 'channel';
  readonly channelId: string;
}

export function resolveLineConfig(config: LineAdapterConfig = {}): ResolvedLineConfig {
  const entry = config.endpoints?.find((item) => item.context === 'line');
  const channelSecret = config.channelSecret
    ?? entry?.channelSecret
    ?? process.env.LINE_CHANNEL_SECRET;
  const channelAccessToken = config.channelAccessToken
    ?? entry?.channelAccessToken
    ?? process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!channelSecret || !channelAccessToken) {
    throw new TypeError(
      'LINE adapter requires channelSecret + channelAccessToken (plugins.<key> or endpoints with context: line)',
    );
  }
  const id = (typeof config.id === 'string' && config.id)
    || (typeof entry?.id === 'string' && entry.id)
    || process.env.LINE_BOT_NAME
    || 'line-bot';
  const webhookPath = normalizeWebhookPath(
    config.webhookPath ?? entry?.webhookPath ?? '/line/webhook',
  );
  const apiBaseUrl = (config.apiBaseUrl ?? entry?.apiBaseUrl ?? 'https://api.line.me').replace(/\/$/, '');
  return {
    context: 'line',
    id,
    channelSecret,
    channelAccessToken,
    webhookPath,
    apiBaseUrl,
  };
}

export function normalizeWebhookPath(path: string): string {
  const trimmed = path.trim() || '/line/webhook';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

export function isMessageEvent(event: LineEvent): event is LineMessageEvent {
  return event.type === 'message' && 'message' in event && (event as LineMessageEvent).message != null;
}

export function isLineLifecycleEvent(event: LineEvent): boolean {
  return event.type === 'follow'
    || event.type === 'unfollow'
    || event.type === 'join'
    || event.type === 'leave';
}

export function isPostbackEvent(event: LineEvent): event is LinePostbackEvent {
  return event.type === 'postback' && 'postback' in event;
}

export function resolveChannel(source: LineSource): LineChannel {
  switch (source.type) {
    case 'user':
      return { channelType: 'private', channelId: source.userId || '' };
    case 'group':
      return { channelType: 'group', channelId: source.groupId || '' };
    case 'room':
      return { channelType: 'channel', channelId: source.roomId || '' };
    default:
      return { channelType: 'private', channelId: '' };
  }
}

/**
 * 入站归一化 → ConversationRef：LINE user → private、group → group、room → channel。
 * LINE 没有 guild/频道容器概念，无 parent；recipient id 前缀（U/G/R）自带场景信息。
 */
export function lineInboundConversation(endpointKey: string, source: LineSource): ConversationRef {
  const channel = resolveChannel(source);
  return {
    endpoint: { id: endpointKey, adapter: endpointKey.split('\0')[0] ?? endpointKey },
    kind: channel.channelType,
    id: channel.channelId,
  };
}

export function generateMessageId(event: LineEvent): string {
  if (isMessageEvent(event) && event.message?.id) return event.message.id;
  return `${event.type}-${event.timestamp}`;
}

/** Build inbound text for OutboundMessageService.receive. */
export function formatInboundContent(event: LineEvent): string {
  if (isMessageEvent(event)) {
    const msg = event.message;
    switch (msg.type) {
      case 'text':
        return msg.text || '';
      case 'location':
        return msg.address || `[location: ${msg.latitude},${msg.longitude}]`;
      case 'image':
        return '[image]';
      case 'video':
        return '[video]';
      case 'audio':
        return '[audio]';
      case 'file':
        return msg.fileName ? `[file: ${msg.fileName}]` : '[file]';
      case 'sticker':
        return `[sticker: ${msg.packageId}/${msg.stickerId}]`;
      default:
        return `[${(msg as LineMessage).type}]`;
    }
  }
  if (event.type === 'follow') return '[follow]';
  if (event.type === 'join') return '[join]';
  if (event.type === 'unfollow') return '[unfollow]';
  if (event.type === 'leave') return '[leave]';
  if (event.type === 'postback') return `[postback: ${event.postback.data}]`;
  return '';
}

export function verifySignature(
  channelSecret: string,
  body: string,
  signature: string,
): boolean {
  const hmac = createHmac('sha256', channelSecret);
  hmac.update(body, 'utf-8');
  const computedSignature = hmac.digest('base64');
  const sigBuf = Buffer.from(signature);
  const computedBuf = Buffer.from(computedSignature);
  if (sigBuf.length !== computedBuf.length) return false;
  return timingSafeEqual(sigBuf, computedBuf);
}

export function isValidLineRecipientId(id: string): boolean {
  return /^[UGR]/.test(id);
}

function buildTextMessage(text: string): LineReplyMessage {
  const truncated = text.length > 5000 ? `${text.slice(0, 4997)}...` : text;
  return { type: 'text', text: truncated };
}

/**
 * 解析 image/audio/video 段的投递源（canonical MediaRef 唯一来源）。
 * LINE Messaging API 媒体消息仅消费远程 HTTPS URL（无上传通道），
 * 因此只有 kind=url 可投递；base64 / path / file 一律 warn + 丢弃。
 */
function resolveMediaUrl(seg: LineWireSegment): string | undefined {
  const media = (seg.data ?? {}).media;
  if (!isMediaRef(media)) {
    logger.warn(formatCompact({
      op: 'line_outbound_media_dropped',
      type: seg.type,
      reason: 'missing_media_ref',
    }));
    return undefined;
  }
  if (media.kind !== 'url') {
    logger.warn(formatCompact({
      op: 'line_outbound_media_dropped',
      type: seg.type,
      reason: 'unsupported_media_kind',
      kind: media.kind,
    }));
    return undefined;
  }
  return media.value;
}

/**
 * Wire-encode an already-rendered outbound payload into LINE Reply/Push messages.
 * Segment canonicalization is intentionally not done here.
 */
export function formatOutboundMessages(payload: unknown): LineReplyMessage[] {
  if (typeof payload === 'string') {
    return [buildTextMessage(payload)];
  }

  const items: Array<string | LineWireSegment> = Array.isArray(payload)
    ? payload as Array<string | LineWireSegment>
    : payload && typeof payload === 'object' && 'type' in (payload as object)
      ? [payload as LineWireSegment]
      : [];

  if (items.length === 0) {
    const text = payload == null
      ? ''
      : typeof payload === 'object'
        ? JSON.stringify(payload)
        : String(payload);
    return [buildTextMessage(text)];
  }

  const messages: LineReplyMessage[] = [];
  for (const item of items) {
    if (typeof item === 'string') {
      messages.push(buildTextMessage(item));
      continue;
    }
    const data = item.data ?? {};
    switch (item.type) {
      case 'text':
        messages.push(buildTextMessage(String(data.text ?? data.content ?? '')));
        break;
      case 'at':
        if (data.id) {
          messages.push(buildTextMessage(`@${String(data.name || data.id)}`));
        }
        break;
      case 'image': {
        const url = resolveMediaUrl(item);
        if (url) {
          messages.push({
            type: 'image',
            originalContentUrl: url,
            previewImageUrl: url,
          });
        }
        break;
      }
      case 'video': {
        const url = resolveMediaUrl(item);
        if (url) {
          messages.push({
            type: 'video',
            originalContentUrl: url,
            previewImageUrl: typeof data.previewUrl === 'string' ? data.previewUrl : url,
          });
        }
        break;
      }
      case 'audio': {
        const url = resolveMediaUrl(item);
        if (url) {
          messages.push({
            type: 'audio',
            originalContentUrl: url,
            duration: typeof data.duration === 'number' ? data.duration : 0,
          });
        }
        break;
      }
      case 'location':
        messages.push({
          type: 'location',
          title: String(data.title || 'Location'),
          address: String(data.address || ''),
          latitude: typeof data.latitude === 'number' ? data.latitude : 0,
          longitude: typeof data.longitude === 'number' ? data.longitude : 0,
        });
        break;
      case 'sticker':
        messages.push({
          type: 'sticker',
          packageId: String(data.package_id || '1'),
          stickerId: String(data.sticker_id || '1'),
        });
        break;
      default:
        messages.push(buildTextMessage(`[${item.type}]`));
    }
  }

  // LINE allows at most 5 messages per Reply/Push request.
  return messages.slice(0, 5);
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
