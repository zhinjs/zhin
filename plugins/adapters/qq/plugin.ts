import { definePlugin, pluginConsoleRpcToken } from 'zhin.js';
import { permissionHostToken } from '@zhin.js/permission';
import { checkQqPlatformPermit } from './src/platform-permit.js';
import { createQqRuntimeState, qqRuntimeStateToken } from './src/qq-runtime-state.js';
import { createQqConsoleRpc } from './src/console.js';
import { cancelQqConsoleBind } from './src/qq-console.js';

export default definePlugin({
  name: 'qq',
  metadata: {
    displayName: 'QQ Official WebSocket Adapter',
  },
  setup(context) {
    const state = createQqRuntimeState();
    context.resources.provide(qqRuntimeStateToken, state);
    context.resources.provide(pluginConsoleRpcToken, createQqConsoleRpc(state, () => context.config.get()));
    const releasePermission = context.resources.has(permissionHostToken)
      ? context.resources.use(permissionHostToken).registerPlatform('qq', checkQqPlatformPermit) : undefined;
    return () => { cancelQqConsoleBind(state); releasePermission?.(); };
  },
});
