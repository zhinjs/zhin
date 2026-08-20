import { createEndpointRuntimeState } from 'zhin.js/adapter';
import { definePlugin } from 'zhin.js';
import { permissionHostToken } from '@zhin.js/permission';
import { checkTelegramPlatformPermit } from './src/platform-permit.js';
import { telegramRuntimeStateToken } from './src/telegram-runtime-state.js';

export default definePlugin({
  name: 'telegram',
  metadata: {
    displayName: 'Telegram Bot API Adapter',
  },
  setup(context) {
    context.resources.provide(telegramRuntimeStateToken, createEndpointRuntimeState());
    if (context.resources.has(permissionHostToken)) {
      const host = context.resources.use(permissionHostToken);
      return host.registerPlatform('telegram', checkTelegramPlatformPermit);
    }
  },
});
