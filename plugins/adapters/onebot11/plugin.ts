import { createEndpointRuntimeState } from 'zhin.js/adapter';
import { definePlugin, pluginConsoleRpcToken } from 'zhin.js';
import { permissionHostToken, createSceneRolePlatformChecker } from '@zhin.js/permission';
import { onebot11RuntimeStateToken } from './src/onebot11-runtime-state.js';
import { createOnebot11ConsoleRpc } from './src/console.js';

export default definePlugin({
  name: 'onebot11',
  metadata: {
    displayName: 'OneBot 11 Adapter',
  },
  setup(context) {
    context.resources.provide(onebot11RuntimeStateToken, createEndpointRuntimeState());
    context.resources.provide(pluginConsoleRpcToken, createOnebot11ConsoleRpc(context.resources, () => context.config.get()));
    if (context.resources.has(permissionHostToken)) {
      const host = context.resources.use(permissionHostToken);
      return host.registerPlatform('onebot11', createSceneRolePlatformChecker());
    }
  },
});
