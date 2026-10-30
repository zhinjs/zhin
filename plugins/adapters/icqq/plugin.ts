import { definePlugin, pluginConsoleRpcToken } from 'zhin.js';
import { permissionHostToken, createSceneRolePlatformChecker } from '@zhin.js/permission';
import { createIcqqConsoleRpc } from './src/console.js';

export default definePlugin({
  name: 'icqq',
  metadata: {
    displayName: 'ICQQ Adapter',
  },
  setup(context) {
    context.resources.provide(pluginConsoleRpcToken, createIcqqConsoleRpc(() => context.config.get()));
    const disposePlatform = context.resources.has(permissionHostToken)
      ? context.resources.use(permissionHostToken).registerPlatform(
        'icqq',
        createSceneRolePlatformChecker(),
      )
      : undefined;
    return disposePlatform;
  },
});
