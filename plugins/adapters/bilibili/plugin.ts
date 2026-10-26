import { createEndpointRuntimeState } from 'zhin.js/adapter';
import { definePlugin } from 'zhin.js';
import { bilibiliRuntimeStateToken } from './src/bilibili-runtime-state.js';

export default definePlugin({
  name: 'bilibili',
  metadata: {
    displayName: 'Bilibili Comment Adapter (Experimental)',
  },
  setup(context) {
    context.resources.provide(bilibiliRuntimeStateToken, createEndpointRuntimeState());
  },
});
