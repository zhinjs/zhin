import { segment } from '../../utils.js';
import { htmlToFallbackText } from '../html-to-text.js';
import { RichSegment } from './base.js';
import { type HtmlRendererForRichSegment, type RichSegmentRenderContext, type RichSegmentRenderResult, RICH_SEGMENT_MODE } from './types.js';
export interface HtmlSegmentData {
  html: string;
  text?: string;
  width?: number;
  backgroundColor?: string;
  fileName?: string;
}

async function resolveHtmlRenderer(
  ctx?: RichSegmentRenderContext,
): Promise<HtmlRendererForRichSegment | undefined> {
  if (!ctx) return undefined;
  if (ctx.resolveCapability) {
    return ctx.resolveCapability<HtmlRendererForRichSegment>('html-renderer');
  }
  return ctx.getHtmlRenderer?.();
}

export class HtmlSegment extends RichSegment<HtmlSegmentData> {
  readonly segmentType = 'html' as const;
  readonly type = 'html' as const;

  async render(mode: string, ctx?: RichSegmentRenderContext): Promise<RichSegmentRenderResult> {
    if (mode === RICH_SEGMENT_MODE.ORIGIN) {
      return this.toJSON();
    }

    if (mode === RICH_SEGMENT_MODE.TEXT) {
      if (typeof this.data.text === 'string' && this.data.text.length > 0) {
        return segment.text(this.data.text);
      }
      const html = typeof this.data.html === 'string' ? this.data.html : '';
      return segment.text(html ? htmlToFallbackText(html) : '');
    }

    if (mode === RICH_SEGMENT_MODE.IMAGE) {
      const html = typeof this.data.html === 'string' ? this.data.html : '';
      if (!html) {
        return segment.text('');
      }

      const renderer = await resolveHtmlRenderer(ctx);
      if (!renderer) {
        return this.render(RICH_SEGMENT_MODE.TEXT, ctx);
      }

      try {
        const result = await renderer.render(html, {
          width: typeof this.data.width === 'number' ? this.data.width : 540,
          format: 'png',
          backgroundColor:
            typeof this.data.backgroundColor === 'string' ? this.data.backgroundColor : '#d8dce3',
        });

        if (result.format !== 'png' || typeof result.data !== 'object') {
          return this.render(RICH_SEGMENT_MODE.TEXT, ctx);
        }

        const base64 = Buffer.from(result.data as Buffer).toString('base64');
        const fileName = typeof this.data.fileName === 'string' ? this.data.fileName : 'card.png';
        return segment('image', { url: `base64://${base64}`, name: fileName });
      } catch {
        return this.render(RICH_SEGMENT_MODE.TEXT, ctx);
      }
    }

    return this.render(RICH_SEGMENT_MODE.TEXT, ctx);
  }
}

export function wrapHtmlSegment(data: Record<string, unknown>): HtmlSegment {
  const html = typeof data.html === 'string' ? data.html : '';
  return new HtmlSegment({
    html,
    text: typeof data.text === 'string' ? data.text : undefined,
    width: typeof data.width === 'number' ? data.width : undefined,
    backgroundColor: typeof data.backgroundColor === 'string' ? data.backgroundColor : undefined,
    fileName: typeof data.fileName === 'string' ? data.fileName : undefined,
  });
}
