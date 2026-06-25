import { segment } from '../../utils.js';
import { RichSegment } from './base.js';
import { markdownToHtmlForRender, markdownToPlainText } from './markdown-to-text.js';
import type {
  HtmlRendererForRichSegment,
  RichSegmentRenderContext,
  RichSegmentRenderResult,
} from './types.js';
import { RICH_SEGMENT_MODE } from './types.js';

export interface MarkdownSegmentData {
  content: string;
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

export class MarkdownSegment extends RichSegment<MarkdownSegmentData> {
  readonly segmentType = 'markdown' as const;
  readonly type = 'markdown' as const;

  async render(mode: string, ctx?: RichSegmentRenderContext): Promise<RichSegmentRenderResult> {
    if (mode === RICH_SEGMENT_MODE.ORIGIN) {
      return { type: 'markdown', data: { content: this.data.content } };
    }

    if (mode === RICH_SEGMENT_MODE.TEXT) {
      return segment.text(markdownToPlainText(this.data.content));
    }

    if (mode === RICH_SEGMENT_MODE.IMAGE) {
      const renderer = await resolveHtmlRenderer(ctx);
      if (!renderer) {
        return this.render(RICH_SEGMENT_MODE.TEXT, ctx);
      }

      try {
        const html = markdownToHtmlForRender(this.data.content);
        const result = await renderer.render(html, {
          width: typeof this.data.width === 'number' ? this.data.width : 540,
          format: 'png',
          backgroundColor:
            typeof this.data.backgroundColor === 'string' ? this.data.backgroundColor : '#ffffff',
        });

        if (result.format !== 'png' || typeof result.data !== 'object') {
          return this.render(RICH_SEGMENT_MODE.TEXT, ctx);
        }

        const base64 = Buffer.from(result.data as Buffer).toString('base64');
        const fileName = typeof this.data.fileName === 'string' ? this.data.fileName : 'markdown.png';
        return segment('image', { url: `base64://${base64}`, name: fileName });
      } catch {
        return this.render(RICH_SEGMENT_MODE.TEXT, ctx);
      }
    }

    return this.render(RICH_SEGMENT_MODE.TEXT, ctx);
  }
}

export function wrapMarkdownSegment(data: Record<string, unknown>): MarkdownSegment {
  const content =
    typeof data.content === 'string'
      ? data.content
      : typeof data.text === 'string'
        ? data.text
        : '';
  return new MarkdownSegment({
    content,
    width: typeof data.width === 'number' ? data.width : undefined,
    backgroundColor: typeof data.backgroundColor === 'string' ? data.backgroundColor : undefined,
    fileName: typeof data.fileName === 'string' ? data.fileName : undefined,
  });
}
