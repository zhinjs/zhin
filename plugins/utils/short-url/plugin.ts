import { definePlugin, Schema } from 'zhin.js';

export default definePlugin({
  name: 'short-url',
  config: Schema.object({}),
  metadata: {
    displayName: 'Short URL',
  },
});
