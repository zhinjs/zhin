import { definePlugin } from '@zhin.js/plugin-runtime';
import { registerSlackPlatformPermitChecker } from './src/platform-permit.js';

export default definePlugin({
  name: 'slack',
  metadata: {
    displayName: 'Slack Adapter',
  },
  setup() {
    // 平台权限门禁：workspace_owner / channel_manager 等（agent 工具 platformPermit）
    return registerSlackPlatformPermitChecker();
  },
});
