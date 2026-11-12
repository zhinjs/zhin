import { definePlugin } from 'zhin.js';
import { createNapcatConsoleRpc } from './src/console.js';

export default definePlugin({
  name: 'napcat',
  configUpdate: { featurePaths: [['nickname'], ['profile'], ['endpoints']] },
  metadata: {
    displayName: 'NapCat Adapter',
  },
  setup(context) {
    return {
      consoleRpc: createNapcatConsoleRpc(context.resources, () => context.config.get()),
    };
  },
});
