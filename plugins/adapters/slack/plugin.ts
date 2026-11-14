import { definePlugin } from 'zhin.js';
import { createSlackConsoleRpc } from './src/console.js';

export default definePlugin({
  name: 'slack',
  configUpdate: { featurePaths: [['nickname'], ['profile'], ['endpoints']] },
  metadata: {
    displayName: 'Slack Adapter',
    displayNameI18n: { 'zh-CN': 'Slack 适配器', en: 'Slack Adapter' },
  },
  setup(context) {
    return {
      consoleRpc: createSlackConsoleRpc(() => context.config.get()),
    };
  },
});
