import { definePlugin } from 'zhin.js';
import { createOnebot12ConsoleRpc } from './src/console.js';

export default definePlugin({
  name: 'onebot12',
  configUpdate: { featurePaths: [['nickname'], ['profile'], ['endpoints']] },
  setup(context) {
    return {
      consoleRpc: createOnebot12ConsoleRpc(context.resources, () => context.config.get()),
    };
  },
});
