import { definePlugin } from 'zhin.js';
import { createNapcatConsoleRpc } from './src/console.js';

export default definePlugin({
  name: 'napcat',
  configUpdate: { featurePaths: [['nickname'], ['profile'], ['endpoints']] },
  setup(context) {
    return {
      consoleRpc: createNapcatConsoleRpc(context.resources, () => context.config.get()),
    };
  },
});
