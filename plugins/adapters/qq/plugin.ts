import { definePlugin } from '@zhin.js/plugin-runtime';
import { registerQqPlatformPermitChecker } from './src/platform-permit.js';

export default definePlugin({
  name: 'qq',
  metadata: {
    displayName: 'QQ Official WebSocket Adapter',
  },
  setup() {
    // 平台权限门禁：guild_owner / guild_admin / manage_roles / manage_channels（agent 工具 platformPermit）
    return registerQqPlatformPermitChecker();
  },
});
