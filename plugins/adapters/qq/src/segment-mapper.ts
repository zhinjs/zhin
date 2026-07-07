import type { MessageSegment, Segment } from 'zhin.js';
import {
  createImageSegment,
  isMediaRef,
  mediaRefFromLegacyData,
  mediaRefToLegacyFields,
} from 'zhin.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readMentionTarget(data: Record<string, unknown>): string {
  const raw = data.target ?? data.user_id ?? data.qq ?? data.id;
  return raw != null ? String(raw) : '';
}

function normalizeMention(seg: MessageSegment): Segment {
  const data = seg.data as Record<string, unknown>;
  const target = readMentionTarget(data);
  const name = typeof data.name === 'string' && data.name ? data.name : undefined;
  return {
    type: 'mention',
    data: name ? { target, name } : { target },
    ...(seg.platform ? { platform: seg.platform } : {}),
  };
}

function normalizeImage(seg: MessageSegment): Segment {
  const data = seg.data as Record<string, unknown>;
  if (isMediaRef(data.media)) {
    return {
      type: 'image',
      data: {
        media: data.media,
        ...(typeof data.alt === 'string' ? { alt: data.alt } : {}),
      },
      ...(seg.platform ? { platform: seg.platform } : {}),
    };
  }
  const media = mediaRefFromLegacyData(data);
  if (!media) return seg as Segment;
  return createImageSegment(media, {
    alt: typeof data.alt === 'string' ? data.alt : undefined,
    platform: seg.platform,
  });
}

function normalizeReply(seg: MessageSegment): Segment {
  const data = seg.data as Record<string, unknown>;
  const messageId = String(data.message_id ?? data.id ?? '').trim();
  if (!messageId) return seg as Segment;
  return { type: 'reply', data: { message_id: messageId } };
}

function normalizeSegment(seg: MessageSegment): Segment {
  if (seg.type === 'at' || seg.type === 'mention') return normalizeMention(seg);
  if (seg.type === 'image') return normalizeImage(seg);
  if (seg.type === 'reply') return normalizeReply(seg);
  if (seg.type === 'face') return seg as Segment;
  if (seg.type === 'markdown') {
    const data = seg.data as Record<string, unknown>;
    const content = typeof data.content === 'string' ? data.content : '';
    return { type: 'markdown', data: { content } };
  }
  return seg as Segment;
}

/** QQ 官方入站段 → canonical Segment[] */
export function toCanonicalSegments(content: readonly MessageSegment[]): Segment[] {
  return content.map((seg) => {
    if (typeof seg === 'string') return { type: 'text', data: { text: seg } };
    return normalizeSegment(seg);
  });
}

/** canonical → QQ 官方 wire */
export function fromCanonicalSegments(segments: readonly Segment[]): MessageSegment[] {
  return segments.map((seg) => {
    if (seg.type === 'image' && isRecord(seg.data) && seg.data.media) {
      const media = seg.data.media as import('zhin.js').MediaRef;
      const legacy = mediaRefToLegacyFields(media);
      return {
        type: 'image',
        data: {
          ...legacy,
          media,
          ...(typeof seg.data.alt === 'string' ? { alt: seg.data.alt } : {}),
        },
        ...(seg.platform ? { platform: seg.platform } : {}),
      };
    }
    if (seg.type === 'mention') {
      const data = seg.data as { target: string; name?: string };
      return {
        type: 'at',
        data: {
          qq: data.target,
          id: data.target,
          ...(data.name ? { name: data.name } : {}),
        },
        ...(seg.platform ? { platform: seg.platform } : {}),
      };
    }
    if (seg.type === 'reply') {
      const messageId = String((seg.data as { message_id: string }).message_id);
      return {
        type: 'reply',
        data: { id: messageId, message_id: messageId },
        ...(seg.platform ? { platform: seg.platform } : {}),
      };
    }
    return seg as MessageSegment;
  });
}
