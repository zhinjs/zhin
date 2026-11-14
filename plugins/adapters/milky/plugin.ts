import { definePlugin } from 'zhin.js';
import { createMilkyConsoleRpc } from './src/console.js';

export default definePlugin({
  name: 'milky',
  configUpdate: { featurePaths: [['nickname'], ['profile'], ['endpoints']] },
  setup(context) {
    return {
      consoleRpc: createMilkyConsoleRpc(context.resources, () => context.config.get()),
    };
  },
});
