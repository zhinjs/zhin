import { definePlugin } from 'zhin.js';
import { createSandboxConsoleRpc } from './src/console.js';

export default definePlugin({
  name: 'sandbox',
  configUpdate: { featurePaths: [['nickname'], ['profile'], ['endpoints']] },
  metadata: {
    displayName: 'Sandbox Adapter',
  },
  setup(context) {
    // Account management in the Console (status, add / start / stop / remove), as for other adapters.
    return {
      consoleRpc: createSandboxConsoleRpc(() => context.config.get()),
    };
  },
});
