import { definePlugin } from '@zhin.js/plugin-runtime';
import { registerWecomPlatformPermitChecker } from './src/platform-permit.js';

export default definePlugin({
  name: 'wecom',
  metadata: {
    displayName: 'WeCom (企业微信) Adapter',
  },
  setup() {
    return registerWecomPlatformPermitChecker();
  },
});
