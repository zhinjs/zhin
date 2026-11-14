import { definePlugin } from 'zhin.js';

export default definePlugin({
  name: 'sandbox',
  configUpdate: { featurePaths: [['nickname'], ['profile'], ['endpoints']] },
  metadata: {
    displayName: 'Sandbox Adapter',
    displayNameI18n: { 'zh-CN': '沙盒适配器', en: 'Sandbox Adapter' },
  },
});
