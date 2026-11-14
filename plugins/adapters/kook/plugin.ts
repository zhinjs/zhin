import { definePlugin } from 'zhin.js';
import { createKookConsoleRpc } from './src/console.js';

export default definePlugin({
  name: 'kook',
  configUpdate: { featurePaths: [['nickname'], ['profile'], ['endpoints']] },
  setup(context) {
    return {
      consoleRpc: createKookConsoleRpc(() => context.config.get()),
    };
  },
});
