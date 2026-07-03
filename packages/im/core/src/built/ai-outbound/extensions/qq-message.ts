/**
 * QQ 官方 Bot API 消息 extension 子集（markdown / ark 占位，按 SDK 文档扩展）。
 */
import type { MessageElement } from '../../../types.js';
import type { AiOutboundExtensionDefinition, AiOutboundParseContext } from '../types.js';

const QQ_MARKDOWN_SCHEMA = {
  type: 'object',
  properties: {
    content: { type: 'string' },
  },
  required: ['content'],
} as const;

export const QQ_MARKDOWN_AI_OUTBOUND_EXTENSION: AiOutboundExtensionDefinition = {
  key: 'qq.markdown',
  schema: QQ_MARKDOWN_SCHEMA,
  examples: ['{"extensions":{"qq.markdown":{"content":"# Title\\nBody"}}}'],
  toMessageElements(ext: unknown, _ctx: AiOutboundParseContext): MessageElement[] {
    if (!ext || typeof ext !== 'object') return [];
    const content = (ext as Record<string, unknown>).content;
    if (typeof content !== 'string' || !content.trim()) return [];
    return [{ type: 'markdown', data: { content: content.trim() } }];
  },
};

export const QQ_AI_OUTBOUND_EXTENSIONS: readonly AiOutboundExtensionDefinition[] = [
  QQ_MARKDOWN_AI_OUTBOUND_EXTENSION,
];
