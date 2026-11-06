import { definePlugin } from 'zhin.js';
import { permissionHostToken } from '@zhin.js/permission';
import { checkQqPlatformPermit } from './src/platform-permit.js';
import { createQqRuntimeState, qqRuntimeStateStore } from './src/qq-runtime-state.js';
import { createQqConsoleRpc } from './src/console.js';
import { cancelQqConsoleBind } from './src/qq-console.js';

export default definePlugin({
  name: 'qq',
  configUpdate: { featurePaths: [['nickname'], ['profile'], ['endpoints']] },
  metadata: {
    displayName: 'QQ Official WebSocket Adapter',
  },
  setup(context) {
    const state = qqRuntimeStateStore.provide(context, createQqRuntimeState());
    const releasePermission = context.resources.has(permissionHostToken)
      ? context.resources.use(permissionHostToken).registerPlatform('qq', checkQqPlatformPermit) : undefined;
    return {
      consoleRpc: createQqConsoleRpc(state, () => context.config.get()),
      dispose: () => { cancelQqConsoleBind(state); releasePermission?.(); },
    };
  },
});
