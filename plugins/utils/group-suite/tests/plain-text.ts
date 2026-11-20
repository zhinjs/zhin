import { isUntrustedContent } from '@zhin.js/core/runtime';

/** The text a reply shows: plain strings, text segments and untrusted (quoted) parts, joined. */
export function plainText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(plainText).join('');
  if (isUntrustedContent(content)) return plainText(content.content);
  const text = (content as { data?: { text?: unknown } } | null)?.data?.text;
  return typeof text === 'string' ? text : '';
}
