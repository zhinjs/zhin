import { definePlugin, pluginConsoleRpcToken } from 'zhin.js';
import { permissionHostToken, createSceneRolePlatformChecker } from '@zhin.js/permission';
import { createOnebot11ConsoleRpc } from './src/console.js';

export default definePlugin({
  name: 'onebot11',
  metadata: {
    displayName: 'OneBot 11 Adapter',
  },
  setup(context) {
    context.resources.provide(pluginConsoleRpcToken, createOnebot11ConsoleRpc(context.resources, () => context.config.get()));
    if (context.resources.has(permissionHostToken)) {
      const host = context.resources.use(permissionHostToken);
      return host.registerPlatform('onebot11', createSceneRolePlatformChecker());
    }
  },
});
