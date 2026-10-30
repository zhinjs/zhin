import { createEndpointRuntimeState } from 'zhin.js/adapter';
import { definePlugin, pluginConsoleRpcToken } from 'zhin.js';
import { permissionHostToken } from '@zhin.js/permission';
import { checkTelegramPlatformPermit } from './src/platform-permit.js';
import { telegramRuntimeStateToken } from './src/telegram-runtime-state.js';
import { createTelegramConsoleRpc } from './src/console.js';

export default definePlugin({
  name: 'telegram',
  metadata: {
    displayName: 'Telegram Bot API Adapter',
  },
  setup(context) {
    context.resources.provide(telegramRuntimeStateToken, createEndpointRuntimeState());
    context.resources.provide(pluginConsoleRpcToken, createTelegramConsoleRpc(context.resources, () => context.config.get()));
    if (context.resources.has(permissionHostToken)) {
      const host = context.resources.use(permissionHostToken);
      return host.registerPlatform('telegram', checkTelegramPlatformPermit);
    }
  },
});
