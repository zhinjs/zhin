import { definePlugin } from 'zhin.js';
import { createWecomConsoleRpc } from './src/console.js';

export default definePlugin({
  name: 'wecom',
  configUpdate: { featurePaths: [['nickname'], ['profile'], ['endpoints']] },
  setup(context) {
    return {
      consoleRpc: createWecomConsoleRpc(context.resources, () => context.config.get()),
    };
  },
});
