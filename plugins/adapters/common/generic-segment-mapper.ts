import type { MessageElement, MessageSegment, Segment } from 'zhin.js';
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
  if (raw === 'all') return 'all';
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
  if (media) {
    const platform: Record<string, unknown> = { ...(seg.platform ?? {}) };
    for (const key of ['url', 'file', 'src', 'file_id'] as const) {
      if (typeof data[key] === 'string' && data[key]) platform[key] = data[key];
    }
    return createImageSegment(media, {
      alt: typeof data.alt === 'string' ? data.alt : undefined,
      platform: Object.keys(platform).length ? platform : undefined,
    });
  }
  return seg as Segment;
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
  return {
    type: 'link',
    data: text ? { url, text } : { url },
    ...(seg.platform ? { platform: seg.platform } : {}),
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
  if (seg.type === 'image') return normalizeImage(seg);
  if (seg.type === 'reply') return normalizeReply(seg);
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

/** 通用 IM adapter：legacy wire → canonical Segment[] */
export function toCanonicalSegments(content: readonly MessageElement[] | readonly unknown[]): Segment[] {
  return asMessageSegments(content).map((seg) => normalizeSegment(seg));
}

/** canonical → wire（mention→at；image MediaRef→legacy 字段） */
export function fromCanonicalSegments(segments: readonly Segment[]): MessageElement[] {
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
    if (seg.type === 'link') {
      const data = seg.data as { url: string; text?: string };
      return {
        type: 'link',
        data: { url: data.url, ...(data.text ? { text: data.text } : {}) },
        ...(seg.platform ? { platform: seg.platform } : {}),
      };
    }
    return seg as MessageElement;
  });
}
