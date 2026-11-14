import { definePlugin } from 'zhin.js';
import { createEmailConsoleRpc } from './src/console.js';

export default definePlugin({
  name: 'email',
  configUpdate: { featurePaths: [['nickname'], ['profile'], ['endpoints']] },
  metadata: {
    displayName: 'Email Adapter',
    displayNameI18n: { 'zh-CN': '邮件适配器', en: 'Email Adapter' },
  },
  setup(context) {
    return {
      consoleRpc: createEmailConsoleRpc(context.resources, () => context.config.get()),
    };
  },
});
