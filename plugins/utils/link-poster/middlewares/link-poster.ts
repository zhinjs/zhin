import { defineMiddleware } from '@zhin.js/middleware';
import type { Message } from '@zhin.js/core/runtime';
import { detectAndParse } from '../src/platforms.js';
import { renderPoster } from '../src/render.js';
import { getLinkPosterRenderer } from '../src/renderer-store.js';

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

    if (!text.includes('http')) {
      await next();
      return;
    }

    try {
      const meta = await detectAndParse(text);
      if (meta) {
        const html = renderPoster(meta);
        const result = await getLinkPosterRenderer().render(html, { width: 480 });
        if (result.format === 'png' && typeof result.data === 'object') {
          const base64 = Buffer.from(result.data as Buffer).toString('base64');
          const dataUrl = `data:${result.mimeType};base64,${base64}`;
          await context.input.$reply([{ type: 'image', data: { url: dataUrl } }]);
        }
      }
    } catch (e) {
      // keep pipeline moving on poster failures, but do not swallow silently
      console.warn(`[link-poster] render failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    await next();
  },
});
