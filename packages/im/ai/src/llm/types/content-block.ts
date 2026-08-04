/** LLM content blocks (ADR 0009 D2). */

/**
 * 与 IM canonical MediaRef 结构同构（ai 层独立声明，不引入 IM 概念）。
 * kind=file：平台不透明引用（Telegram file_id 等），序列化时按 provider 能力处理。
 */
export interface MediaBlockRef {
  kind: 'url' | 'path' | 'base64' | 'file';
  value: string;
  mime_type?: string;
  file_name?: string;
  size?: number;
}

export interface TextContentBlock {
  type: 'text';
  text: string;
}

/**
 * 媒体内容块：与 canonical Segment（image/audio/video/file）子集同构，
 * agent 层透传零转换。用户消息的媒体经 `UserMessage.media` 承载（不持久化）。
 */
export interface MediaContentBlock {
  type: 'image' | 'audio' | 'video' | 'file';
  data: {
    media: MediaBlockRef;
    alt?: string;
  };
}

export interface ThinkingContentBlock {
  type: 'thinking';
  thinking: string;
}

export interface ToolCallContentBlock {
  type: 'toolCall';
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type ContentBlock =
  | TextContentBlock
  | MediaContentBlock
  | ThinkingContentBlock
  | ToolCallContentBlock;

export type UserContentBlock = TextContentBlock;

export type ToolResultContentBlock = TextContentBlock | MediaContentBlock;

const MEDIA_BLOCK_TYPES = new Set(['image', 'audio', 'video', 'file']);

export function isMediaBlockRef(value: unknown): value is MediaBlockRef {
  if (!value || typeof value !== 'object') return false;
  const ref = value as Partial<MediaBlockRef>;
  return (ref.kind === 'url' || ref.kind === 'path' || ref.kind === 'base64' || ref.kind === 'file')
    && typeof ref.value === 'string'
    && ref.value.length > 0;
}

export function isMediaContentBlock(value: unknown): value is MediaContentBlock {
  if (!value || typeof value !== 'object') return false;
  const block = value as { type?: unknown; data?: unknown };
  if (typeof block.type !== 'string' || !MEDIA_BLOCK_TYPES.has(block.type)) return false;
  const data = block.data as { media?: unknown } | undefined;
  return !!data && isMediaBlockRef(data.media);
}
