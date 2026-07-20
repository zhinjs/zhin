import { definePlugin } from '@zhin.js/plugin-runtime';
import { registerLarkPlatformPermitChecker } from './src/platform-permit.js';

export default definePlugin({
  name: 'lark',
  metadata: {
    displayName: 'Lark/Feishu (飞书) Adapter',
  },
  setup() {
    return registerLarkPlatformPermitChecker();
  },
});
