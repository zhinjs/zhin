import type { ChatMessage } from '../types.js';

/**
 * CJK 字符（汉字、日文假名、韩文音节、CJK 标点、全角字符）。
 * 这些字符在现代 tokenizer 下约 1 字 ≈ 1 token，远高于英文的 4 字符 ≈ 1 token，
 * 直接用 length/4 会对中文会话低估约 4 倍，导致 auto-compact 阈值失灵。
 */
const CJK_CHAR_PATTERN =
  /[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/g;

/** 按 CJK 分段加权估算文本 token 数：CJK 约 1 字 1 token，其余约 4 字符 1 token。 */
export function estimateTextTokens(text: string): number {
  if (!text) return 0;
  const cjkChars = (text.match(CJK_CHAR_PATTERN) || []).length;
  const otherChars = text.length - cjkChars;
  return Math.ceil(cjkChars + otherChars / 4);
}

export function estimateTokens(message: ChatMessage): number {
  const content = typeof message.content === 'string'
    ? message.content
    : JSON.stringify(message.content);
  const reasoning =
    typeof message.reasoning_content === 'string' ? message.reasoning_content : '';
  return estimateTextTokens(content + reasoning) + 4;
}

export function estimateMessagesTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m), 0);
}
