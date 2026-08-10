import { createEndpointRuntimeState } from '@zhin.js/adapter';
import { definePlugin } from '@zhin.js/plugin-runtime';
import { permissionHostToken } from '@zhin.js/permission';
import { checkWecomPlatformPermit } from './src/platform-permit.js';
import { wecomRuntimeStateToken } from './src/wecom-runtime-state.js';

export default definePlugin({
  name: 'wecom',
  metadata: {
    displayName: 'WeCom (企业微信) Adapter',
  },
  setup(context) {
    context.resources.provide(wecomRuntimeStateToken, createEndpointRuntimeState());
    if (context.resources.has(permissionHostToken)) {
      const host = context.resources.use(permissionHostToken);
      return host.registerPlatform('wecom', checkWecomPlatformPermit);
    }
  },
});
