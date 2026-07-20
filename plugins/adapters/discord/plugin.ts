import { definePlugin } from '@zhin.js/plugin-runtime';
import { registerDiscordPlatformPermitChecker } from './src/platform-permit.js';

export default definePlugin({
  name: 'discord',
  metadata: {
    displayName: 'Discord Gateway Adapter',
  },
  setup() {
    // 平台权限门禁：guild_owner / moderate_members 等（agent 工具 platformPermit）
    return registerDiscordPlatformPermitChecker();
  },
});
