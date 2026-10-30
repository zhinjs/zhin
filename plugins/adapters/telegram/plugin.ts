import { definePlugin, pluginConsoleRpcToken } from 'zhin.js';
import { permissionHostToken } from '@zhin.js/permission';
import { checkTelegramPlatformPermit } from './src/platform-permit.js';
import { createTelegramConsoleRpc } from './src/console.js';

export default definePlugin({
  name: 'telegram',
  metadata: {
    displayName: 'Telegram Bot API Adapter',
  },
  setup(context) {
    context.resources.provide(pluginConsoleRpcToken, createTelegramConsoleRpc(() => context.config.get()));
    if (context.resources.has(permissionHostToken)) {
      const host = context.resources.use(permissionHostToken);
      return host.registerPlatform('telegram', checkTelegramPlatformPermit);
    }
  },
});
