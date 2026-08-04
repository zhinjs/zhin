import type { MessageElement, MessageSegment } from '../types.js';
import type { MediaRef, Segment } from './segment-contract/types.js';
import {
  isMediaRef,
  readMentionTarget,
} from './segment-contract/index.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readPlatform(seg: MessageSegment): Record<string, unknown> | undefined {
  const platform = (seg as Segment).platform;
  return platform && typeof platform === 'object' ? platform : undefined;
}

function normalizeMention(seg: MessageSegment): Segment {
  const data = seg.data as Record<string, unknown>;
  const target = readMentionTarget(data);
  const name = typeof data.name === 'string' && data.name ? data.name : undefined;
  const platform = readPlatform(seg);
  return {
    type: 'mention',
    data: name ? { target, name } : { target },
    ...(platform ? { platform } : {}),
  };
}

const MEDIA_SEGMENT_TYPES = new Set(['image', 'audio', 'video', 'file']);

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function legacyMediaRef(data: Record<string, unknown>): MediaRef | undefined {
  if (isMediaRef(data.media)) return data.media;

  const url = nonEmptyString(data.url) ?? nonEmptyString(data.href) ?? nonEmptyString(data.src);
  const path = nonEmptyString(data.path) ?? nonEmptyString(data.file_path);
  const base64 = nonEmptyString(data.base64);
  const file = nonEmptyString(data.file) ?? nonEmptyString(data.file_id);
  const value = url ?? path ?? base64 ?? file;
  if (!value) return undefined;

  const kind = url ? 'url'
    : path ? 'path'
      : base64 ? 'base64'
        : /^(?:[a-z][a-z0-9+.-]*:)?\/\//iu.test(value) ? 'url'
          : /^(?:\.{1,2}\/|\/|~\/)/u.test(value) ? 'path'
            : 'file';
  const mimeType = nonEmptyString(data.mime_type) ?? nonEmptyString(data.mimeType);
  // Legacy top-level fileName names the rendered file segment. Keep source
  // metadata reserved for an explicit media object instead of duplicating it.
  const fileName = nonEmptyString(data.media_file_name);
  const size = typeof data.size === 'number' && Number.isFinite(data.size) ? data.size : undefined;
  return {
    kind,
    value,
    ...(mimeType ? { mime_type: mimeType } : {}),
    ...(fileName ? { file_name: fileName } : {}),
    ...(size === undefined ? {} : { size }),
  };
}

/**
 * The sole ingress compatibility boundary for media. Adapters may emit their
 * native `url`/`path`/`file` fields, but every consumer receives `data.media`.
 */
function normalizeMedia(seg: MessageSegment): Segment {
  const data = seg.data as Record<string, unknown>;
  const platform = readPlatform(seg);
  const media = legacyMediaRef(data);
  if (!media) return seg as Segment;
  const attributes = seg.type === 'image'
    ? { ...(typeof data.alt === 'string' ? { alt: data.alt } : {}) }
    : seg.type === 'audio'
      ? { ...(typeof data.duration === 'number' ? { duration: data.duration } : {}) }
      : seg.type === 'video'
        ? {
          ...(typeof data.duration === 'number' ? { duration: data.duration } : {}),
          ...(typeof data.alt === 'string' ? { alt: data.alt } : {}),
        }
        : {
          ...(nonEmptyString(data.name) ?? nonEmptyString(data.file_name) ?? nonEmptyString(data.fileName)
            ? { name: nonEmptyString(data.name) ?? nonEmptyString(data.file_name) ?? nonEmptyString(data.fileName) }
            : {}),
        };
  return {
    type: seg.type,
    data: { media, ...attributes },
    ...(platform ? { platform } : {}),
  };
}

function normalizeReply(seg: MessageSegment): Segment {
  const data = seg.data as Record<string, unknown>;
  const messageId = String(data.message_id ?? data.id ?? '').trim();
  if (!messageId) return seg as Segment;
  return { type: 'reply', data: { message_id: messageId } };
}

function normalizeLink(seg: MessageSegment): Segment {
  const data = seg.data as Record<string, unknown>;
  const url = String(data.url ?? data.href ?? '').trim();
  if (!url) return seg as Segment;
  const text = typeof data.text === 'string' && data.text ? data.text : undefined;
  const platform = readPlatform(seg);
  return {
    type: 'link',
    data: text ? { url, text } : { url },
    ...(platform ? { platform } : {}),
  };
}

function normalizeForward(seg: MessageSegment): Segment {
  const data = seg.data as Record<string, unknown>;
  const forwardId = String(data.forward_id ?? data.id ?? data.resid ?? '').trim();
  if (!forwardId) return seg as Segment;
  const title = typeof data.title === 'string' ? data.title : undefined;
  const messages = Array.isArray(data.messages) ? data.messages : undefined;
  const platform: Record<string, unknown> = { ...(readPlatform(seg) ?? {}) };
  if (data.resid != null) platform.resid = String(data.resid);
  return {
    type: 'forward',
    data: {
      forward_id: forwardId,
      ...(title ? { title } : {}),
      ...(messages ? { messages: messages as Segment[][] } : {}),
    },
    ...(Object.keys(platform).length ? { platform } : {}),
  };
}

function isPlatformSticker(seg: MessageSegment): boolean {
  if (seg.type !== 'sticker') return false;
  const data = seg.data as Record<string, unknown>;
  return data.package_id != null
    || data.sticker_id != null
    || data.packageId != null
    || data.stickerId != null;
}

function normalizeFace(seg: MessageSegment): Segment {
  if (isPlatformSticker(seg)) return seg as Segment;
  const data = seg.data as Record<string, unknown>;
  const rawId = data.id ?? data.face_id;
  const name = typeof data.name === 'string'
    ? data.name
    : typeof data.text === 'string'
      ? data.text
      : undefined;
  const platform = readPlatform(seg);
  return {
    type: 'face',
    data: {
      ...(rawId != null ? { id: rawId as string | number } : {}),
      ...(name ? { name } : {}),
    },
    ...(platform ? { platform } : {}),
  };
}

function normalizeMarkdown(seg: MessageSegment): Segment {
  const data = seg.data as Record<string, unknown>;
  const content = typeof data.content === 'string'
    ? data.content
    : typeof data.text === 'string'
      ? data.text
      : '';
  return { type: 'markdown', data: { content } };
}

function normalizeSegment(seg: MessageSegment): Segment {
  if (seg.type === 'at' || seg.type === 'mention') return normalizeMention(seg);
  if (MEDIA_SEGMENT_TYPES.has(seg.type)) return normalizeMedia(seg);
  if (seg.type === 'reply') return normalizeReply(seg);
  if (seg.type === 'forward') return normalizeForward(seg);
  if (seg.type === 'sticker' && isPlatformSticker(seg)) return seg as Segment;
  if (seg.type === 'face' || seg.type === 'sticker' || seg.type === 'emoji') return normalizeFace(seg);
  if (seg.type === 'link') return normalizeLink(seg);
  if (seg.type === 'markdown') return normalizeMarkdown(seg);
  return seg as Segment;
}

function asMessageSegments(content: readonly unknown[]): MessageSegment[] {
  return content.map((item) => {
    if (typeof item === 'string') return { type: 'text', data: { text: item } };
    return item as MessageSegment;
  });
}

/** wire 段数组 → canonical Segment[]（包括所有媒体的 `data.media` 归一）。 */
export function toCanonicalSegments(content: readonly MessageElement[] | readonly unknown[]): Segment[] {
  return asMessageSegments(content).map((seg) => normalizeSegment(seg));
}
