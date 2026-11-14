import { definePlugin } from 'zhin.js';
import { createLarkConsoleRpc } from './src/console.js';

export default definePlugin({
  name: 'lark',
  configUpdate: { featurePaths: [['nickname'], ['profile'], ['endpoints']] },
  metadata: {
    displayName: 'Lark/Feishu (飞书) Adapter',
    displayNameI18n: { 'zh-CN': '飞书适配器', en: 'Lark/Feishu Adapter' },
  },
  setup(context) {
    return {
      consoleRpc: createLarkConsoleRpc(context.resources, () => context.config.get()),
    };
  },
});
