import { definePlugin } from 'zhin.js';
import { createOnebot11ConsoleRpc } from './src/console.js';

export default definePlugin({
  name: 'onebot11',
  configUpdate: { featurePaths: [['nickname'], ['profile'], ['endpoints']] },
  setup(context) {
    return {
      consoleRpc: createOnebot11ConsoleRpc(context.resources, () => context.config.get()),
    };
  },
});
