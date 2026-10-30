import { definePlugin, pluginConsoleRpcToken } from 'zhin.js';
import { permissionHostToken } from '@zhin.js/permission';
import { checkKookPlatformPermit } from './src/platform-permit.js';
import { createKookConsoleRpc } from './src/console.js';

export default definePlugin({
  name: 'kook',
  metadata: {
    displayName: 'KOOK WebSocket Adapter',
  },
  setup(context) {
    context.resources.provide(pluginConsoleRpcToken, createKookConsoleRpc(() => context.config.get()));
    if (context.resources.has(permissionHostToken)) {
      const host = context.resources.use(permissionHostToken);
      return host.registerPlatform('kook', checkKookPlatformPermit);
    }
  },
});
