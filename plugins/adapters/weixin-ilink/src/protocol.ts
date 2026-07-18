/**
 * Weixin iLink protocol helpers (no legacy Adapter/Endpoint / segment-mapper).
 * Canonicalization is owned by gateway/core before endpoint.send.
 */

import { pickCredential } from '@zhin.js/adapter';
import { bodyFromItemList, isMediaItem } from './weixin-inbound.js';
import { DEFAULT_API_BASE_URL, DEFAULT_CDN_BASE_URL } from './ilink-meta.js';
import type { WeixinMessage } from './ilink-types.js';

/** Plugin Runtime owner config (`plugins.<instanceKey>` / schema.json). */
export interface WeixinIlinkAdapterConfig {
  readonly name?: string;
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
  readonly name: string;
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
  const name = (typeof config.name === 'string' && config.name)
    || (typeof entry?.name === 'string' && entry.name)
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
    name,
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

export function segmentLocalPath(seg: WeixinWireSegment): string | undefined {
  const data = seg.data ?? {};
  const candidates = [data.file, data.path, data.url].filter(
    (value): value is string => typeof value === 'string' && Boolean(value),
  );
  const ref = candidates[0];
  if (!ref || ref.startsWith('base64://') || /^data:/.test(ref) || /^https?:\/\//i.test(ref)) {
    return undefined;
  }
  return ref.replace(/^file:\/\//, '');
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
