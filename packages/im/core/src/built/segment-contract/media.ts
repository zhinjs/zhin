import type { MediaRef, Segment } from './types.js';
import { isMediaRef } from './validate.js';

export { isMediaRef };
export function mediaRefFromLegacyData(data: Record<string, unknown>): MediaRef | undefined {
  if (isMediaRef(data.media)) {
    return data.media;
  }

  const mimeType = typeof data.mime_type === 'string' ? data.mime_type : undefined;

  // 平台不透明文件引用（Telegram file_id / Milky resource_id 等）
  const fileRef = typeof data.file_id === 'string' && data.file_id.trim()
    ? data.file_id.trim()
    : undefined;
  if (fileRef) {
    return { kind: 'file', value: fileRef, ...(mimeType ? { mime_type: mimeType } : {}) };
  }

  const base64 =
    typeof data.base64 === 'string' && data.base64.trim()
      ? data.base64.trim()
      : typeof data.data === 'string' && data.data.trim() && !String(data.data).startsWith('http')
        ? data.data.trim()
        : undefined;
  if (base64) {
    return { kind: 'base64', value: base64, ...(mimeType ? { mime_type: mimeType } : {}) };
  }

  const raw = [data.url, data.file, data.src, data.href]
    .find((v): v is string => typeof v === 'string' && v.trim().length > 0);
  if (!raw) return undefined;

  const value = raw.trim();
  if (value.startsWith('base64://')) {
    return { kind: 'base64', value: value.slice('base64://'.length), ...(mimeType ? { mime_type: mimeType } : {}) };
  }
  if (value.startsWith('http://') || value.startsWith('https://')) {
    return { kind: 'url', value, ...(mimeType ? { mime_type: mimeType } : {}) };
  }
  if (value.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(value)) {
    return { kind: 'path', value, ...(mimeType ? { mime_type: mimeType } : {}) };
  }
  return { kind: 'url', value, ...(mimeType ? { mime_type: mimeType } : {}) };
}

export function mediaRefToLegacyFields(media: MediaRef): { url?: string; file?: string } {
  if (media.kind === 'url') return { url: media.value, file: media.value };
  if (media.kind === 'path') return { file: media.value, url: media.value };
  if (media.kind === 'file') return { file: media.value, url: media.value };
  const encoded = media.value.startsWith('base64://') ? media.value : `base64://${media.value}`;
  return { file: encoded, url: encoded };
}

/** 入站段携带媒体引用的段类型（纯文本视图无法承载的信息）。 */
const MEDIA_SEGMENT_TYPES = new Set(['image', 'audio', 'video', 'file']);

export interface SegmentMediaRef {
  readonly type: string;
  readonly media: MediaRef;
}

/**
 * 从入站 canonical 段收集媒体引用（image / audio / video / file）。
 * 兼容 canonical `data.media` 与旧轨 url/file/base64 字段；
 * 无媒体段时返回空数组（调用方无需特判 undefined）。
 */
export function collectSegmentMedia(segments: readonly Segment[] | undefined): SegmentMediaRef[] {
  if (!segments?.length) return [];
  const out: SegmentMediaRef[] = [];
  for (const segment of segments) {
    if (!segment || typeof segment.type !== 'string' || !MEDIA_SEGMENT_TYPES.has(segment.type)) {
      continue;
    }
    const media = mediaRefFromLegacyData(segment.data ?? {});
    if (media) out.push({ type: segment.type, media });
  }
  return out;
}
