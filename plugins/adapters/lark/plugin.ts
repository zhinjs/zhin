import { createEndpointRuntimeState } from 'zhin.js/adapter';
import { definePlugin, pluginConsoleRpcToken } from 'zhin.js';
import { permissionHostToken } from '@zhin.js/permission';
import { checkLarkPlatformPermit } from './src/platform-permit.js';
import { larkRuntimeStateToken } from './src/lark-runtime-state.js';
import { createLarkConsoleRpc } from './src/console.js';

export default definePlugin({
  name: 'lark',
  metadata: {
    displayName: 'Lark/Feishu (飞书) Adapter',
  },
  setup(context) {
    context.resources.provide(larkRuntimeStateToken, createEndpointRuntimeState());
    context.resources.provide(pluginConsoleRpcToken, createLarkConsoleRpc(context.resources, () => context.config.get()));
    if (context.resources.has(permissionHostToken)) {
      const host = context.resources.use(permissionHostToken);
      return host.registerPlatform('lark', checkLarkPlatformPermit);
    }
  },
});
