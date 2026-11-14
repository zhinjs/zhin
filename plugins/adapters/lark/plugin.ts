import { definePlugin } from 'zhin.js';
import { createLarkConsoleRpc } from './src/console.js';

export default definePlugin({
  name: 'lark',
  configUpdate: { featurePaths: [['nickname'], ['profile'], ['endpoints']] },
  setup(context) {
    return {
      consoleRpc: createLarkConsoleRpc(context.resources, () => context.config.get()),
    };
  },
});
