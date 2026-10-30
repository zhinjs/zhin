import { createEndpointRuntimeState } from 'zhin.js/adapter';
import { definePlugin, pluginConsoleRpcToken } from 'zhin.js';
import { permissionHostToken } from '@zhin.js/permission';
import { checkKookPlatformPermit } from './src/platform-permit.js';
import { kookRuntimeStateToken } from './src/kook-runtime-state.js';
import { createKookConsoleRpc } from './src/console.js';

export default definePlugin({
  name: 'kook',
  metadata: {
    displayName: 'KOOK WebSocket Adapter',
  },
  setup(context) {
    context.resources.provide(kookRuntimeStateToken, createEndpointRuntimeState());
    context.resources.provide(pluginConsoleRpcToken, createKookConsoleRpc(context.resources, () => context.config.get()));
    if (context.resources.has(permissionHostToken)) {
      const host = context.resources.use(permissionHostToken);
      return host.registerPlatform('kook', checkKookPlatformPermit);
    }
  },
});
