import { definePlugin } from 'zhin.js';
import { createDingtalkConsoleRpc } from './src/console.js';

export default definePlugin({
  name: 'dingtalk',
  configUpdate: { featurePaths: [['nickname'], ['profile'], ['endpoints']] },
  metadata: {
    displayName: 'DingTalk (钉钉) Adapter',
    displayNameI18n: { 'zh-CN': '钉钉适配器', en: 'DingTalk Adapter' },
  },
  setup(context) {
    return {
      consoleRpc: createDingtalkConsoleRpc(context.resources, () => context.config.get()),
    };
  },
});
