import { createEndpointRuntimeState } from '@zhin.js/adapter';
import { definePlugin } from '@zhin.js/plugin-runtime';
import { permissionHostToken } from '@zhin.js/permission';
import { checkLarkPlatformPermit } from './src/platform-permit.js';
import { larkRuntimeStateToken } from './src/lark-runtime-state.js';

export default definePlugin({
  name: 'lark',
  metadata: {
    displayName: 'Lark/Feishu (飞书) Adapter',
  },
  setup(context) {
    context.resources.provide(larkRuntimeStateToken, createEndpointRuntimeState());
    if (context.resources.has(permissionHostToken)) {
      const host = context.resources.use(permissionHostToken);
      return host.registerPlatform('lark', checkLarkPlatformPermit);
    }
  },
});
