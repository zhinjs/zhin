import { createEndpointRuntimeState } from '@zhin.js/adapter';
import { definePlugin } from '@zhin.js/plugin-runtime';
import { permissionHostToken } from '@zhin.js/permission';
import { checkKookPlatformPermit } from './src/platform-permit.js';
import { kookRuntimeStateToken } from './src/kook-runtime-state.js';

export default definePlugin({
  name: 'kook',
  metadata: {
    displayName: 'KOOK WebSocket Adapter',
  },
  setup(context) {
    context.resources.provide(kookRuntimeStateToken, createEndpointRuntimeState());
    if (context.resources.has(permissionHostToken)) {
      const host = context.resources.use(permissionHostToken);
      return host.registerPlatform('kook', checkKookPlatformPermit);
    }
  },
});
