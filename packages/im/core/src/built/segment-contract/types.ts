/**
 * Canonical Segment SSOT — IM + AI 共用 JSON 形状（snake_case data）。
 * @see docs/architecture/segment-content-model.md
 */

export interface SegmentBase {
  type: string;
  data: Record<string, unknown>;
  platform?: Record<string, unknown>;
}

/** 媒体引用占位（完整 schema 随 adapter 迁移补齐） */
export interface MediaRef {
  kind: 'url' | 'path' | 'base64';
  value: string;
  mime_type?: string;
}

export interface TextSegment extends SegmentBase {
  type: 'text';
  data: { text: string };
}

export interface MentionSegment extends SegmentBase {
  type: 'mention';
  data: { target: string; name?: string };
}

/** 规范态 segment（#550 起：text + mention 严格校验；其余 type 宽松透传） */
export type Segment = TextSegment | MentionSegment | SegmentBase;

/** @deprecated 使用 Segment；保留别名供 Console / adapter 渐进迁移 */
export type MessageSegment = Segment;
