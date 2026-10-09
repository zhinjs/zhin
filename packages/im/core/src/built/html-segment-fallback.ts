/**
 * Convert unresolved `html` segments to portable text content.
 * Canonical outbound rendering owns when this fallback is applied.
 */
import type { MessageElement } from '../types.js';
type SegmentContent = string | MessageElement | readonly SegmentContent[];
import { segment } from '../utils.js';
import { htmlToFallbackText } from './html-to-text.js';

function asArray(content: SegmentContent): (string | MessageElement)[] {
  return Array.isArray(content) ? content.flatMap(item => asArray(item)) : [content as string | MessageElement];
}

function resolveHtmlSegmentText(data: Record<string, unknown>): string {
  if (typeof data.text === 'string' && data.text.length > 0) return data.text;
  if (typeof data.html === 'string') return htmlToFallbackText(data.html);
  return '';
}

export function coerceHtmlSegmentsToText(content: SegmentContent): SegmentContent {
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
