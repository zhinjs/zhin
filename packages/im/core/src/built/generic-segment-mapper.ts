import type { MessageElement, MessageSegment, SendContent } from '../types.js';
import type { MediaRef, Segment } from './segment-contract/types.js';
import {
  createImageSegment,
  isMediaRef,
  mediaRefFromLegacyData,
  mediaRefToLegacyFields,
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

function normalizeImage(seg: MessageSegment): Segment {
  const data = seg.data as Record<string, unknown>;
  const platform = readPlatform(seg);
  if (isMediaRef(data.media)) {
    return {
      type: 'image',
      data: {
        media: data.media,
        ...(typeof data.alt === 'string' ? { alt: data.alt } : {}),
      },
      ...(platform ? { platform } : {}),
    };
  }
  const media = mediaRefFromLegacyData(data);
  if (media) {
    const mergedPlatform: Record<string, unknown> = { ...(platform ?? {}) };
    for (const key of ['url', 'file', 'src', 'file_id'] as const) {
      if (typeof data[key] === 'string' && data[key]) mergedPlatform[key] = data[key];
    }
    const platformKeys = Object.keys(mergedPlatform);
    const legacyPlatform = platformKeys.length === 0
      ? undefined
      : platformKeys.length === 1 && mergedPlatform[platformKeys[0]!] === media.value
        ? undefined
        : mergedPlatform;
    return createImageSegment(media, {
      alt: typeof data.alt === 'string' ? data.alt : undefined,
      platform: legacyPlatform,
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
  if (seg.type === 'image') return normalizeImage(seg);
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

function asCanonicalSegments(content: SendContent): Segment[] {
  if (typeof content === 'string') {
    return [{ type: 'text', data: { text: content } }];
  }
  const items = Array.isArray(content) ? content : [content];
  return items.map((item) => {
    if (typeof item === 'string') return { type: 'text', data: { text: item } };
    return item as Segment;
  });
}

/** 通用 IM adapter：legacy wire → canonical Segment[] */
export function toCanonicalSegments(content: readonly MessageElement[] | readonly unknown[]): Segment[] {
  return asMessageSegments(content).map((seg) => normalizeSegment(seg));
}

function mapCanonicalToWire(seg: Segment): MessageElement {
  if (seg.type === 'image' && isRecord(seg.data) && seg.data.media) {
    const media = seg.data.media as MediaRef;
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
  if (seg.type === 'forward') {
    const data = seg.data as { forward_id: string; title?: string; messages?: unknown };
    const resid = (seg.platform as { resid?: string } | undefined)?.resid ?? data.forward_id;
    return {
      type: 'forward',
      data: {
        id: data.forward_id,
        resid,
        ...(data.title ? { title: data.title } : {}),
        ...(data.messages ? { messages: data.messages } : {}),
      },
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
}

/** canonical → wire（mention→at；image MediaRef→legacy 字段） */
export function fromCanonicalSegments(content: SendContent): MessageElement[] {
  return asCanonicalSegments(content).map((seg) => mapCanonicalToWire(seg));
}
