import { definePlugin } from 'zhin.js';
import { createHtmlRenderer } from '@zhin.js/html-renderer';
import { linkPosterRendererToken } from './src/runtime.js';

export default definePlugin({
  name: 'link-poster',
  metadata: {
    displayName: 'Link Poster',
  },
  setup(context) {
    context.resources.provide(linkPosterRendererToken, createHtmlRenderer());
  },
});
