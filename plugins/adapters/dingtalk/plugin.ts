import { definePlugin } from 'zhin.js';
import { createDingtalkConsoleRpc } from './src/console.js';

export default definePlugin({
  name: 'dingtalk',
  configUpdate: { featurePaths: [['nickname'], ['profile'], ['endpoints']] },
  setup(context) {
    return {
      consoleRpc: createDingtalkConsoleRpc(context.resources, () => context.config.get()),
    };
  },
});
