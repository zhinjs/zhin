import type { HtmlRendererHost } from '@zhin.js/plugin-runtime';
import { htmlToFallbackText } from '../../built/html-to-text.js';

/**
 * Outbound payload normalization for the Plugin Runtime IM pipeline.
 *
 * `raw()` payloads reach adapters as-is; adapters only understand wire
 * segments (`{ type, data }` arrays). A single segment object (non-array)
 * would otherwise fall through to `String(payload)` → '[object Object]'.
 * `html` segments additionally need a Host renderer: image when
 * `@zhin.js/html-renderer` is installed, plain-text fallback otherwise.
 */

export interface OutboundSegment {
  readonly type: string;
  readonly data?: Record<string, unknown>;
}

const DEFAULT_CARD_WIDTH = 540;
const DEFAULT_CARD_FILENAME = 'card.png';

export function isOutboundSegment(value: unknown): value is OutboundSegment {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && typeof (value as { type?: unknown }).type === 'string';
}

/**
 * Normalize a rendered outbound payload to wire segments:
 * - segment arrays stay arrays (html segments converted per element);
 * - a single segment object is wrapped into a one-element array;
 * - anything else (plain strings, legacy `{ text }` shorthands) passes through.
 */
export async function normalizeOutboundPayload(
  payload: unknown,
  renderer?: HtmlRendererHost,
): Promise<unknown> {
  if (Array.isArray(payload)) {
    return Promise.all(payload.map((item) => normalizeOutboundSegment(item, renderer)));
  }
  if (isOutboundSegment(payload)) {
    return [await normalizeOutboundSegment(payload, renderer)];
  }
  return payload;
}

async function normalizeOutboundSegment(
  segment: unknown,
  renderer?: HtmlRendererHost,
): Promise<unknown> {
  if (!isOutboundSegment(segment) || segment.type !== 'html') return segment;
  const data = segment.data ?? {};
  const html = typeof data.html === 'string' ? data.html : '';
  if (html && renderer) {
    try {
      const result = await renderer.render(html, {
        width: typeof data.width === 'number' ? data.width : DEFAULT_CARD_WIDTH,
        format: 'png',
        ...(typeof data.backgroundColor === 'string'
          ? { backgroundColor: data.backgroundColor }
          : {}),
      });
      if (result.format === 'png' && result.data && typeof result.data === 'object') {
        return {
          type: 'image',
          data: {
            base64: Buffer.from(result.data as Uint8Array).toString('base64'),
            name: typeof data.fileName === 'string' ? data.fileName : DEFAULT_CARD_FILENAME,
          },
        };
      }
    } catch {
      // 渲染失败 → 文本降级
    }
  }
  return { type: 'text', data: { text: htmlSegmentFallbackText(data, html) } };
}

function htmlSegmentFallbackText(data: Record<string, unknown>, html: string): string {
  if (typeof data.text === 'string' && data.text.length > 0) return data.text;
  return html ? htmlToFallbackText(html) : '';
}
