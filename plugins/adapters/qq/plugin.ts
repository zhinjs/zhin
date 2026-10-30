import { definePlugin, pluginConsoleRpcToken } from 'zhin.js';
import { permissionHostToken } from '@zhin.js/permission';
import { checkQqPlatformPermit } from './src/platform-permit.js';
import { createQqRuntimeState, qqRuntimeStateToken } from './src/qq-runtime-state.js';
import { createQqConsoleRpc } from './src/console.js';

export default definePlugin({
  name: 'qq',
  metadata: {
    displayName: 'QQ Official WebSocket Adapter',
  },
  setup(context) {
    const state = createQqRuntimeState();
    context.resources.provide(qqRuntimeStateToken, state);
    context.resources.provide(pluginConsoleRpcToken, createQqConsoleRpc(state, context.resources, () => context.config.get()));
    if (context.resources.has(permissionHostToken)) {
      const host = context.resources.use(permissionHostToken);
      return host.registerPlatform('qq', checkQqPlatformPermit);
    }
  },
});
