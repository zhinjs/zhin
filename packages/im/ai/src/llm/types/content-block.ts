/** LLM content blocks (ADR 0009 D2). */

export interface TextContentBlock {
  type: 'text';
  text: string;
}

export interface ImageContentBlock {
  type: 'image';
  data: string;
  mimeType: string;
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
  | ImageContentBlock
  | ThinkingContentBlock
  | ToolCallContentBlock;

export type UserContentBlock = TextContentBlock | ImageContentBlock;

export type ToolResultContentBlock = TextContentBlock | ImageContentBlock;

export interface ImageContent {
  type: 'image';
  data: string;
  mimeType: string;
}
