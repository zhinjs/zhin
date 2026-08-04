import type { MediaRef, Segment } from './types.js';
import { isMediaRef } from './validate.js';

export { isMediaRef };

/** 入站段携带媒体引用的段类型（纯文本视图无法承载的信息）。 */
const MEDIA_SEGMENT_TYPES = new Set(['image', 'audio', 'video', 'file']);

export interface SegmentMediaRef {
  readonly type: string;
  readonly media: MediaRef;
}

/**
 * 从入站 canonical 段收集媒体引用（image / audio / video / file）。
 * 只认 canonical `data.media`；无媒体段时返回空数组（调用方无需特判 undefined）。
 */
export function collectSegmentMedia(segments: readonly Segment[] | undefined): SegmentMediaRef[] {
  if (!segments?.length) return [];
  const out: SegmentMediaRef[] = [];
  for (const segment of segments) {
    if (!segment || typeof segment.type !== 'string' || !MEDIA_SEGMENT_TYPES.has(segment.type)) {
      continue;
    }
    const media = (segment.data as Record<string, unknown> | undefined)?.media;
    if (isMediaRef(media)) out.push({ type: segment.type, media });
  }
  return out;
}
