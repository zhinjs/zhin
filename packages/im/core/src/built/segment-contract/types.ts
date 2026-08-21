/** Canonical Segment SSOT lives in @zhin.js/im-contract. */
import type {
  ForwardSegment,
  MediaRef,
  MentionSegment,
  ReplySegment,
  Segment,
  SegmentBase,
  TextSegment,
} from '@zhin.js/im-contract';

export type {
  ForwardSegment,
  MediaRef,
  MentionSegment,
  ReplySegment,
  Segment,
  SegmentBase,
  TextSegment,
} from '@zhin.js/im-contract';

/**
 * 媒体引用占位（全框架唯一媒体表达）。
 * kind=file：平台侧不透明文件引用（如 Telegram file_id、Milky resource_id），
 * 非 URL/本地路径，消费方需经平台 API 解析。
 */
export interface ImageSegment extends SegmentBase {
  type: 'image';
  data: { media: MediaRef; alt?: string };
}

export interface AudioSegment extends SegmentBase {
  type: 'audio';
  data: { media: MediaRef; duration?: number };
}

export interface VideoSegment extends SegmentBase {
  type: 'video';
  data: { media: MediaRef; duration?: number; alt?: string };
}

export interface FileSegment extends SegmentBase {
  type: 'file';
  data: { media: MediaRef; name?: string };
}

export interface FaceSegment extends SegmentBase {
  type: 'face';
  data: { id: string | number; name?: string };
}

export interface DiceSegment extends SegmentBase {
  type: 'dice';
  data: { result?: number };
}

export interface RpsSegment extends SegmentBase {
  type: 'rps';
  data: { result?: number };
}

/** 规范态 segment（严格校验 text / mention / image / audio / video / file / reply / forward / face / dice / rps） */
export type LegacySpecificSegment = ImageSegment | AudioSegment | VideoSegment | FileSegment | FaceSegment | DiceSegment | RpsSegment;
