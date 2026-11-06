import { definePluginStore } from 'zhin.js';
import type { HtmlRendererService } from '@zhin.js/html-renderer';

export const linkPosterRendererStore = definePluginStore<HtmlRendererService>(
  'zhin.link-poster.renderer',
  'Generation-owned Link Poster renderer',
);
export const linkPosterRendererToken = linkPosterRendererStore;
