import { definePlugin } from 'zhin.js';
import { createOnebot12ConsoleRpc } from './src/console.js';

export default definePlugin({
  name: 'onebot12',
  configUpdate: { featurePaths: [['nickname'], ['profile'], ['endpoints']] },
  metadata: {
    displayName: 'OneBot 12 Adapter',
    displayNameI18n: { 'zh-CN': 'OneBot 12 适配器', en: 'OneBot 12 Adapter' },
  },
  setup(context) {
    return {
      consoleRpc: createOnebot12ConsoleRpc(context.resources, () => context.config.get()),
    };
  },
});
