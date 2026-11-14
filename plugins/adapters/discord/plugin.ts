import { definePlugin } from 'zhin.js';
import { createDiscordConsoleRpc } from './src/console.js';

export default definePlugin({
  name: 'discord',
  configUpdate: { featurePaths: [['nickname'], ['profile'], ['endpoints']] },
  metadata: {
    displayName: 'Discord Gateway Adapter',
    displayNameI18n: { 'zh-CN': 'Discord 适配器', en: 'Discord Gateway Adapter' },
  },
  setup(context) {
    return {
      consoleRpc: createDiscordConsoleRpc(() => context.config.get()),
    };
  },
});
