import type { MessageSegment, Segment } from '@zhin.js/core';
import {
  createImageSegment,
  isMediaRef,
  mediaRefFromLegacyData,
  mediaRefToLegacyFields,
} from '@zhin.js/core';

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
  if (!media) return seg as Segment;

  const platform: Record<string, unknown> = { ...(seg.platform ?? {}) };
  for (const key of ['url', 'file', 'src'] as const) {
    if (typeof data[key] === 'string' && data[key]) platform[key] = data[key];
  }

  return createImageSegment(media, {
    alt: typeof data.alt === 'string' ? data.alt : undefined,
    platform: Object.keys(platform).length ? platform : undefined,
  });
}

function normalizeSegment(seg: MessageSegment): Segment {
  if (seg.type === 'at' || seg.type === 'mention') return normalizeMention(seg);
  if (seg.type === 'image') return normalizeImage(seg);
  return seg as Segment;
}

/** 入站 legacy / CQ 段 → canonical Segment[] */
export function toCanonicalSegments(content: readonly MessageSegment[]): Segment[] {
  return content.map((seg) => {
    if (typeof seg === 'string') return { type: 'text', data: { text: seg } };
    return normalizeSegment(seg);
  });
}

/** 出站：canonical → ICQQ wire（CQ 构建仍读 url/file + media） */
export function fromCanonicalSegments(segments: readonly Segment[]): MessageSegment[] {
  return segments.map((seg) => {
    if (seg.type === 'image' && isRecord(seg.data) && seg.data.media) {
      const media = seg.data.media as import('@zhin.js/core').MediaRef;
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
          ...(data.name ? { name: data.name } : {}),
        },
        ...(seg.platform ? { platform: seg.platform } : {}),
      };
    }
    return seg as MessageSegment;
  });
}
