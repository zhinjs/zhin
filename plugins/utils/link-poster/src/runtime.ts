import { createToken } from 'zhin.js';
import type { HtmlRendererService } from '@zhin.js/html-renderer';

export const linkPosterRendererToken = createToken<HtmlRendererService>(
  'zhin.link-poster.renderer',
  'Generation-owned Link Poster renderer',
);
