import { definePlugin } from 'zhin.js';
import { createKookConsoleRpc } from './src/console.js';

export default definePlugin({
  name: 'kook',
  configUpdate: { featurePaths: [['nickname'], ['profile'], ['endpoints']] },
  metadata: {
    displayName: 'KOOK WebSocket Adapter',
    displayNameI18n: { 'zh-CN': 'KOOK 适配器', en: 'KOOK WebSocket Adapter' },
  },
  setup(context) {
    return {
      consoleRpc: createKookConsoleRpc(() => context.config.get()),
    };
  },
});
