import { definePlugin, pluginConsoleRpcToken } from 'zhin.js';
import { permissionHostToken, createSceneRolePlatformChecker } from '@zhin.js/permission';
import { createNapcatConsoleRpc } from './src/console.js';

export default definePlugin({
  name: 'napcat',
  metadata: {
    displayName: 'NapCat Adapter',
  },
  setup(context) {
    context.resources.provide(pluginConsoleRpcToken, createNapcatConsoleRpc(context.resources, () => context.config.get()));
    if (context.resources.has(permissionHostToken)) {
      const host = context.resources.use(permissionHostToken);
      return host.registerPlatform('napcat', createSceneRolePlatformChecker());
    }
  },
});
