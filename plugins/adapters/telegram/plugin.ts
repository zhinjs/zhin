import { definePlugin } from 'zhin.js';
import { createTelegramConsoleRpc } from './src/console.js';

export default definePlugin({
  name: 'telegram',
  configUpdate: { featurePaths: [['nickname'], ['profile'], ['endpoints']] },
  setup(context) {
    return {
      consoleRpc: createTelegramConsoleRpc(() => context.config.get()),
    };
  },
});
