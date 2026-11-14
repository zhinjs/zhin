import { definePlugin } from 'zhin.js';
import { createTelegramConsoleRpc } from './src/console.js';

export default definePlugin({
  name: 'telegram',
  configUpdate: { featurePaths: [['nickname'], ['profile'], ['endpoints']] },
  metadata: {
    displayName: 'Telegram Bot API Adapter',
    displayNameI18n: { 'zh-CN': 'Telegram 适配器', en: 'Telegram Bot API Adapter' },
  },
  setup(context) {
    return {
      consoleRpc: createTelegramConsoleRpc(() => context.config.get()),
    };
  },
});
