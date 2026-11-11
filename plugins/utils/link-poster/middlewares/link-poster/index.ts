import { defineMiddleware } from 'zhin.js/middleware';
import type { Message } from '@zhin.js/core/runtime';
import { detectAndParse } from '../../src/platforms.js';
import { renderPoster } from '../../src/render.js';
import { linkPosterRendererToken } from '../../src/runtime.js';
import { resolveLocale } from 'zhin.js/i18n';

/**
 * Detect Bilibili / GitHub / Douyin / Xiaohongshu links and reply with a poster image.
 * Uses Runtime Message.content (legacy used $raw).
 */
export default defineMiddleware<Message>({
  target: 'inbound',
  async handle(context, next) {
    const text = typeof context.input.content === 'string'
      ? context.input.content
      : '';

    if (!text.includes('http')) return next();

    // Capture the language before any await: an in-flight operation keeps the language it started with.
    const locale = resolveLocale(context.input.locale);
    // Let commands and the Agent handle the message first; fetching and rendering a poster can
    // take seconds and must not hold them back. The poster is an extra reply sent afterwards.
    const downstream = await next();

    try {
      const meta = await detectAndParse(text, locale);
      if (meta) {
        const html = renderPoster(meta, locale);
        const result = await context.use(linkPosterRendererToken).render(html, { width: 480 });
        if (result.format === 'png' && typeof result.data === 'object') {
          const base64 = Buffer.from(result.data as Buffer).toString('base64');
          const dataUrl = `data:${result.mimeType};base64,${base64}`;
          await context.input.$reply([{ type: 'image', data: { url: dataUrl } }]);
        }
      }
    } catch (e) {
      // A poster failure never affects the rest of the pipeline, but it is not swallowed silently.
      console.warn(`[link-poster] render failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    return downstream;
  },
});
