import { createEndpointRuntimeState } from 'zhin.js/adapter';
import { definePlugin } from 'zhin.js/plugin-runtime';
import { permissionHostToken, createSceneRolePlatformChecker } from '@zhin.js/permission';
import { napcatRuntimeStateToken } from './src/napcat-runtime-state.js';

export default definePlugin({
  name: 'napcat',
  metadata: {
    displayName: 'NapCat Adapter',
  },
  setup(context) {
    context.resources.provide(napcatRuntimeStateToken, createEndpointRuntimeState());
    if (context.resources.has(permissionHostToken)) {
      const host = context.resources.use(permissionHostToken);
      return host.registerPlatform('napcat', createSceneRolePlatformChecker());
    }
  },
});
