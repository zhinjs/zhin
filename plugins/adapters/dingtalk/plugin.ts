import { definePlugin } from '@zhin.js/plugin-runtime';
import { registerDingtalkPlatformPermitChecker } from './src/platform-permit.js';

export default definePlugin({
  name: 'dingtalk',
  metadata: {
    displayName: 'DingTalk (钉钉) Adapter',
  },
  setup() {
    return registerDingtalkPlatformPermitChecker();
  },
});
