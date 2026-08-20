import { definePlugin } from 'zhin.js/plugin-runtime';
import { permissionHostToken } from '@zhin.js/permission';
import { checkQqPlatformPermit } from './src/platform-permit.js';
import { createQqRuntimeState, qqRuntimeStateToken } from './src/qq-runtime-state.js';

export default definePlugin({
  name: 'qq',
  metadata: {
    displayName: 'QQ Official WebSocket Adapter',
  },
  setup(context) {
    context.resources.provide(qqRuntimeStateToken, createQqRuntimeState());
    if (context.resources.has(permissionHostToken)) {
      const host = context.resources.use(permissionHostToken);
      return host.registerPlatform('qq', checkQqPlatformPermit);
    }
  },
});
