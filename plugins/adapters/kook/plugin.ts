import { definePlugin } from '@zhin.js/plugin-runtime';
import { registerKookPlatformPermitChecker } from './src/platform-permit.js';

export default definePlugin({
  name: 'kook',
  metadata: {
    displayName: 'KOOK WebSocket Adapter',
  },
  setup() {
    // 平台权限门禁：guild_owner / guild_admin / channel_admin 等（agent 工具 platformPermit）
    return registerKookPlatformPermitChecker();
  },
});
