import { definePlugin } from 'zhin.js';
import { createHtmlRenderer } from '@zhin.js/html-renderer';
import { linkPosterRendererStore } from './src/runtime.js';

export default definePlugin({
  name: 'link-poster',
  metadata: {
    displayName: 'Link Poster',
  },
  setup(context) {
    linkPosterRendererStore.provide(context, createHtmlRenderer());
  },
});
