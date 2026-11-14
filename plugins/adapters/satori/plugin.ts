import { definePlugin } from 'zhin.js';
import { createSatoriConsoleRpc } from './src/console.js';

export default definePlugin({
  name: 'satori',
  configUpdate: { featurePaths: [['nickname'], ['profile'], ['endpoints']] },
  setup(context) {
    return {
      consoleRpc: createSatoriConsoleRpc(context.resources, () => context.config.get()),
    };
  },
});
