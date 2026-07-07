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

function normalizeReply(seg: MessageSegment): Segment {
  const data = seg.data as Record<string, unknown>;
  const messageId = String(data.message_id ?? data.id ?? '').trim();
  if (!messageId) return seg as Segment;
  return { type: 'reply', data: { message_id: messageId } };
}

function normalizeForward(seg: MessageSegment): Segment {
  const data = seg.data as Record<string, unknown>;
  const forwardId = String(
    data.forward_id ?? data.id ?? data.resid ?? data.res_id ?? '',
  ).trim();
  if (!forwardId) return seg as Segment;

  const platform: Record<string, unknown> = { ...(seg.platform ?? {}) };
  for (const key of ['resid', 'res_id'] as const) {
    if (typeof data[key] === 'string' && data[key]) platform[key] = data[key];
  }

  return {
    type: 'forward',
    data: {
      forward_id: forwardId,
      ...(typeof data.title === 'string' && data.title ? { title: data.title } : {}),
      ...(Array.isArray(data.messages) ? { messages: data.messages as Segment[][] } : {}),
    },
    ...(Object.keys(platform).length ? { platform } : {}),
  };
}

function normalizeFace(seg: MessageSegment): Segment {
  const data = seg.data as Record<string, unknown>;
  const id = data.id ?? data.face_id;
  if (id == null || id === '') return seg as Segment;
  const name =
    typeof data.name === 'string' && data.name
      ? data.name
      : typeof data.text === 'string' && data.text
        ? data.text
        : undefined;
  return {
    type: 'face',
    data: {
      id: typeof id === 'number' ? id : String(id),
      ...(name ? { name } : {}),
    },
    ...(seg.platform ? { platform: seg.platform } : {}),
  };
}

function normalizeGame(seg: MessageSegment, type: 'dice' | 'rps'): Segment {
  const data = seg.data as Record<string, unknown>;
  const result = typeof data.result === 'number' ? data.result : undefined;
  return {
    type,
    data: result != null ? { result } : {},
    ...(seg.platform ? { platform: seg.platform } : {}),
  };
}

function normalizeSegment(seg: MessageSegment): Segment {
  if (seg.type === 'at' || seg.type === 'mention') return normalizeMention(seg);
  if (seg.type === 'image') return normalizeImage(seg);
  if (seg.type === 'reply') return normalizeReply(seg);
  if (seg.type === 'forward') return normalizeForward(seg);
  if (seg.type === 'face' || seg.type === 'sticker' || seg.type === 'emoji') {
    return normalizeFace(seg);
  }
  if (seg.type === 'dice' || seg.type === 'rps') return normalizeGame(seg, seg.type);
  return seg as Segment;
}

/** 入站 legacy / CQ 段 → canonical Segment[] */
export function toCanonicalSegments(content: readonly MessageSegment[]): Segment[] {
  return content.map((seg) => {
    if (typeof seg === 'string') return { type: 'text', data: { text: seg } };
    return normalizeSegment(seg);
  });
}

/** 出站：canonical → OneBot11 wire（CQ 构建仍读 url/file + media） */
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
    if (seg.type === 'forward') {
      const data = seg.data as {
        forward_id: string;
        title?: string;
        messages?: unknown;
      };
      const platform = { ...(seg.platform ?? {}) };
      const resid = platform.resid ?? data.forward_id;
      return {
        type: 'forward',
        data: {
          id: data.forward_id,
          forward_id: data.forward_id,
          resid,
          ...(data.title ? { title: data.title } : {}),
          ...(data.messages ? { messages: data.messages } : {}),
        },
        platform: { ...platform, resid },
      };
    }
    return seg as MessageSegment;
  });
}
