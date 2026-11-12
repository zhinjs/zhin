import { definePlugin } from 'zhin.js';
import { createOnebot11ConsoleRpc } from './src/console.js';

export default definePlugin({
  name: 'onebot11',
  configUpdate: { featurePaths: [['nickname'], ['profile'], ['endpoints']] },
  metadata: {
    displayName: 'OneBot 11 Adapter',
  },
  setup(context) {
    return {
      consoleRpc: createOnebot11ConsoleRpc(context.resources, () => context.config.get()),
    };
  },
});
