import { definePlugin } from '@zhin.js/plugin-runtime';
import { registerTelegramPlatformPermitChecker } from './src/platform-permit.js';

export default definePlugin({
  name: 'telegram',
  metadata: {
    displayName: 'Telegram Bot API Adapter',
  },
  setup() {
    // 平台权限门禁：chat_creator / chat_administrator / pin_messages 等（agent 工具 platformPermit）
    return registerTelegramPlatformPermitChecker();
  },
});
