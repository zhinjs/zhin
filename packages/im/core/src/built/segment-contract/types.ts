/**
 * Canonical Segment SSOT — IM + AI 共用 JSON 形状（snake_case data）。
 * @see docs/architecture/segment-content-model.md
 */

export interface SegmentBase {
  type: string;
  data: Record<string, unknown>;
  platform?: Record<string, unknown>;
}

/**
 * 媒体引用占位（全框架唯一媒体表达）。
 * kind=file：平台侧不透明文件引用（如 Telegram file_id、Milky resource_id），
 * 非 URL/本地路径，消费方需经平台 API 解析。
 */
export interface MediaRef {
  kind: 'url' | 'path' | 'base64' | 'file';
  value: string;
  mime_type?: string;
  file_name?: string;
  /** 字节数（已知时携带，供大小预检与日志） */
  size?: number;
}

export interface TextSegment extends SegmentBase {
  type: 'text';
  data: { text: string };
}

export interface MentionSegment extends SegmentBase {
  type: 'mention';
  data: { target: string; name?: string };
}

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

export interface ReplySegment extends SegmentBase {
  type: 'reply';
  data: { message_id: string };
}

export interface ForwardSegment extends SegmentBase {
  type: 'forward';
  data: {
    forward_id: string;
    title?: string;
    messages?: Segment[][];
  };
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
export type Segment =
  | TextSegment
  | MentionSegment
  | ImageSegment
  | AudioSegment
  | VideoSegment
  | FileSegment
  | ReplySegment
  | ForwardSegment
  | FaceSegment
  | DiceSegment
  | RpsSegment
  | SegmentBase;
