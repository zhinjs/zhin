/**
 * Weixin iLink protocol helpers (no legacy Adapter/Endpoint / segment-mapper).
 * Canonicalization is owned by gateway/core before endpoint.send.
 */

import { pickCredential } from '@zhin.js/adapter';
import { isMediaRef } from '@zhin.js/core';
import type { ConversationRef } from '@zhin.js/im-contract';
import { bodyFromItemList, isMediaItem } from './weixin-inbound.js';
import { DEFAULT_API_BASE_URL, DEFAULT_CDN_BASE_URL } from './ilink-meta.js';
import type { WeixinMessage } from './ilink-types.js';

/** Plugin Runtime owner config (`plugins.<instanceKey>` / schema.json). */
export interface WeixinIlinkAdapterConfig {
  readonly id?: string;
  readonly botAgent?: string;
  readonly baseUrl?: string;
  readonly cdnBaseUrl?: string;
  readonly longPollTimeoutMs?: number;
  readonly botToken?: string;
  /** Transitional: legacy root `endpoints[]` with `context: weixin-ilink`. */
  readonly endpoints?: ReadonlyArray<Partial<ResolvedWeixinIlinkConfig> & {
    readonly context?: string;
  }>;
}

export interface ResolvedWeixinIlinkConfig {
  readonly context: 'weixin-ilink';
  readonly id: string;
  readonly botAgent?: string;
  readonly baseUrl: string;
  readonly cdnBaseUrl: string;
  readonly longPollTimeoutMs: number;
  readonly botToken?: string;
}

export type WeixinIlinkEndpointConfig = ResolvedWeixinIlinkConfig;

export interface WeixinWireSegment {
  readonly type: string;
  readonly data?: Record<string, unknown>;
}

export interface WeixinInboundMediaPaths {
  readonly decryptedPicPath?: string;
  readonly decryptedVideoPath?: string;
  readonly decryptedFilePath?: string;
  readonly decryptedVoicePath?: string;
}

export type WeixinMessageWithMedia = WeixinMessage & {
  readonly _media?: WeixinInboundMediaPaths;
};

const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000;

export function resolveWeixinIlinkConfig(
  config: WeixinIlinkAdapterConfig = {},
): ResolvedWeixinIlinkConfig {
  const entry = config.endpoints?.find((item) => item.context === 'weixin-ilink');
  const id = (typeof config.id === 'string' && config.id)
    || (typeof entry?.id === 'string' && entry.id)
    || process.env.WEIXIN_ILINK_BOT_NAME
    || 'weixin-ilink-bot';
  const botToken = pickCredential(
    typeof config.botToken === 'string' ? config.botToken.trim() : config.botToken,
    typeof entry?.botToken === 'string' ? entry.botToken.trim() : entry?.botToken,
    process.env.WEIXIN_ILINK_TOKEN?.trim(),
  );
  // No throw here: missing botToken is resolved later by resolveCredentials()
  // (sidecar credentials file / QR login) during endpoint.start().
  return {
    context: 'weixin-ilink',
    id,
    botAgent: config.botAgent ?? entry?.botAgent,
    baseUrl: config.baseUrl ?? entry?.baseUrl ?? DEFAULT_API_BASE_URL,
    cdnBaseUrl: config.cdnBaseUrl ?? entry?.cdnBaseUrl ?? DEFAULT_CDN_BASE_URL,
    longPollTimeoutMs: config.longPollTimeoutMs
      ?? entry?.longPollTimeoutMs
      ?? DEFAULT_LONG_POLL_TIMEOUT_MS,
    botToken,
  };
}

/** Build inbound text for MessageGateway.receive (gateway owns reply routing). */
export function formatInboundContent(msg: WeixinMessageWithMedia): string {
  const parts: string[] = [];
  const text = bodyFromItemList(msg.item_list);
  if (text) parts.push(text);

  const media = msg._media;
  if (media?.decryptedPicPath) {
    parts.push(`[image: ${media.decryptedPicPath}]`);
  } else if (media?.decryptedVideoPath) {
    parts.push(`[video: ${media.decryptedVideoPath}]`);
  } else if (media?.decryptedFilePath) {
    parts.push(`[file: ${media.decryptedFilePath}]`);
  } else if (media?.decryptedVoicePath) {
    parts.push(`[record: ${media.decryptedVoicePath}]`);
  } else if (!text && msg.item_list?.some((item) => isMediaItem(item))) {
    parts.push('[媒体消息]');
  }

  return parts.join('\n').trim() || '';
}

export function inboundMessageId(msg: WeixinMessage): string {
  return String(msg.message_id ?? msg.client_id ?? msg.seq ?? Date.now());
}

/**
 * 入站归一化 → ConversationRef：个人微信无群/频道概念，全部会话都是
 * 与 `from_user_id` 的 private 会话（无 parent）。
 */
export function weixinIlinkInboundConversation(endpointKey: string, userId: string): ConversationRef {
  return {
    endpoint: { id: endpointKey, adapter: endpointKey.split('\0')[0] ?? endpointKey },
    kind: 'private',
    id: userId,
  };
}

/**
 * Wire-encode an already-rendered outbound payload into Weixin wire segments.
 * Segment canonicalization is intentionally not done here.
 */
export function formatOutboundSegments(payload: unknown): WeixinWireSegment[] {
  if (typeof payload === 'string') {
    return [{ type: 'text', data: { text: payload } }];
  }

  const items: Array<string | WeixinWireSegment> = Array.isArray(payload)
    ? payload as Array<string | WeixinWireSegment>
    : payload && typeof payload === 'object' && 'type' in (payload as object)
      ? [payload as WeixinWireSegment]
      : [];

  if (items.length === 0) {
    const text = payload == null
      ? ''
      : typeof payload === 'object'
        ? JSON.stringify(payload)
        : String(payload);
    return [{ type: 'text', data: { text } }];
  }

  const segs: WeixinWireSegment[] = [];
  for (const item of items) {
    if (typeof item === 'string') {
      segs.push({ type: 'text', data: { text: item } });
      continue;
    }
    segs.push({ type: item.type, data: item.data ?? {} });
  }
  return segs.length ? segs : [{ type: 'text', data: { text: '' } }];
}

/** 物化后的媒体段（data.media kind=path）→ 本地文件路径；其余返回 undefined。 */
export function segmentLocalPath(seg: WeixinWireSegment): string | undefined {
  const media = (seg.data ?? {}).media;
  if (!isMediaRef(media) || media.kind !== 'path') return undefined;
  return media.value;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
