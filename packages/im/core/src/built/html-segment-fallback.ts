/**
 * Convert unresolved `html` segments to portable text content.
 * Canonical outbound rendering owns when this fallback is applied.
 */
import type { MessageElement, SendContent } from '../types.js';
import { segment } from '../utils.js';
import { htmlToFallbackText } from './html-to-text.js';

function asArray(content: SendContent): (string | MessageElement)[] {
  return Array.isArray(content) ? content : [content];
}

function resolveHtmlSegmentText(data: Record<string, unknown>): string {
  if (typeof data.text === 'string' && data.text.length > 0) return data.text;
  if (typeof data.html === 'string') return htmlToFallbackText(data.html);
  return '';
}

export function coerceHtmlSegmentsToText(content: SendContent): SendContent {
  const items = asArray(content);
  const out: (string | MessageElement)[] = [];
  for (const item of items) {
    if (typeof item === 'string') {
      out.push(item);
      continue;
    }
    if (item?.type === 'html') {
      const text = resolveHtmlSegmentText(item.data ?? {});
      if (text) out.push(segment.text(text));
      continue;
    }
    out.push(item);
  }
  if (out.length === 0) return segment.text('');
  if (out.length === 1) return out[0]!;
  return out;
}
