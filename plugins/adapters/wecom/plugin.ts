import { createEndpointRuntimeState } from 'zhin.js/adapter';
import { definePlugin, pluginConsoleRpcToken } from 'zhin.js';
import { permissionHostToken } from '@zhin.js/permission';
import { checkWecomPlatformPermit } from './src/platform-permit.js';
import { wecomRuntimeStateToken } from './src/wecom-runtime-state.js';
import { createWecomConsoleRpc } from './src/console.js';

export default definePlugin({
  name: 'wecom',
  metadata: {
    displayName: 'WeCom (企业微信) Adapter',
  },
  setup(context) {
    context.resources.provide(wecomRuntimeStateToken, createEndpointRuntimeState());
    context.resources.provide(pluginConsoleRpcToken, createWecomConsoleRpc(context.resources, () => context.config.get()));
    if (context.resources.has(permissionHostToken)) {
      const host = context.resources.use(permissionHostToken);
      return host.registerPlatform('wecom', checkWecomPlatformPermit);
    }
  },
});
