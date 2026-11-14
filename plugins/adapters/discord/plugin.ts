import { definePlugin } from 'zhin.js';
import { createDiscordConsoleRpc } from './src/console.js';

export default definePlugin({
  name: 'discord',
  configUpdate: { featurePaths: [['nickname'], ['profile'], ['endpoints']] },
  setup(context) {
    return {
      consoleRpc: createDiscordConsoleRpc(() => context.config.get()),
    };
  },
});
