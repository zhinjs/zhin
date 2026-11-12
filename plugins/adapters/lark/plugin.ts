import { definePlugin } from 'zhin.js';
import { createLarkConsoleRpc } from './src/console.js';

export default definePlugin({
  name: 'lark',
  configUpdate: { featurePaths: [['nickname'], ['profile'], ['endpoints']] },
  metadata: {
    displayName: 'Lark/Feishu (飞书) Adapter',
  },
  setup(context) {
    return {
      consoleRpc: createLarkConsoleRpc(context.resources, () => context.config.get()),
    };
  },
});
