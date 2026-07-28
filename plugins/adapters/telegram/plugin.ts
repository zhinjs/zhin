import { createEndpointRuntimeState } from '@zhin.js/adapter';
import { definePlugin } from '@zhin.js/plugin-runtime';
import { registerTelegramPlatformPermitChecker } from './src/platform-permit.js';
import { telegramRuntimeStateToken } from './src/telegram-runtime-state.js';

export default definePlugin({
  name: 'telegram',
  metadata: {
    displayName: 'Telegram Bot API Adapter',
  },
  setup(context) {
    // 运行中 endpoint 注册表（telegram endpoint list 的"运行中"数据源）
    context.resources.provide(telegramRuntimeStateToken, createEndpointRuntimeState());
    // 平台权限门禁：chat_creator / chat_administrator / pin_messages 等（agent 工具 platformPermit）
    return registerTelegramPlatformPermitChecker();
  },
});
