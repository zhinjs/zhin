import type { ContentPart } from '../types.js';

/**
 * Extract plain text from a user message for tool filtering / preview.
 *
 * Accepts either a plain string or a multimodal `ContentPart[]` array;
 * in the latter case only the `text` parts are concatenated.
 */
export function userMessageToFilterText(message: string | ContentPart[]): string {
  if (typeof message === 'string') return message;
  return message
    .filter((p): p is ContentPart & { type: 'text'; text: string } => p.type === 'text' && Boolean(p.text?.trim()))
    .map(p => p.text)
    .join('\n');
}
