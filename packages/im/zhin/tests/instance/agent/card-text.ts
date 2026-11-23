import { isUntrustedContent, type SendContent } from '@zhin.js/core';

/** #1250: a card's text as the approver reads it (literal pieces unwrapped). */
export function cardText(content: SendContent | null | undefined): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(item => cardText(item as SendContent)).join('');
  if (isUntrustedContent(content)) return cardText(content.content);
  const text = (content as { data?: { text?: unknown } }).data?.text;
  return typeof text === 'string' ? text : '';
}

/** Whether `content` carries `literal` only inside a literal (`untrustedContent`) piece. */
export function literalPieces(content: SendContent | null | undefined): string[] {
  if (content == null || typeof content === 'string') return [];
  if (Array.isArray(content)) return content.flatMap(item => literalPieces(item as SendContent));
  return isUntrustedContent(content) ? [cardText(content.content)] : [];
}
