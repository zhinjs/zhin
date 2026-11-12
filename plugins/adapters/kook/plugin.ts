import { definePlugin } from 'zhin.js';
import { createKookConsoleRpc } from './src/console.js';

export default definePlugin({
  name: 'kook',
  configUpdate: { featurePaths: [['nickname'], ['profile'], ['endpoints']] },
  metadata: {
    displayName: 'KOOK WebSocket Adapter',
  },
  setup(context) {
    return {
      consoleRpc: createKookConsoleRpc(() => context.config.get()),
    };
  },
});
