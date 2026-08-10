import { createEndpointRuntimeState } from '@zhin.js/adapter';
import { definePlugin } from '@zhin.js/plugin-runtime';
import { permissionHostToken, createSceneRolePlatformChecker } from '@zhin.js/permission';
import { onebot11RuntimeStateToken } from './src/onebot11-runtime-state.js';

export default definePlugin({
  name: 'onebot11',
  metadata: {
    displayName: 'OneBot 11 Adapter',
  },
  setup(context) {
    context.resources.provide(onebot11RuntimeStateToken, createEndpointRuntimeState());
    if (context.resources.has(permissionHostToken)) {
      const host = context.resources.use(permissionHostToken);
      return host.registerPlatform('onebot11', createSceneRolePlatformChecker());
    }
  },
});
