import { defineCommand } from 'zhin.js/command';
import { definePlugin } from 'zhin.js';

export default definePlugin({
  name: 'production-bot',
  metadata: { displayName: 'Production Bot' },
  setup({ addCommand }) {
    addCommand('health', defineCommand({
      description: 'Verify the active plugin generation',
      execute: () => 'ok',
    }));
  },
});
