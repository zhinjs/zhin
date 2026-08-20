import { createEndpointRuntimeState } from 'zhin.js/adapter';
import { definePlugin } from 'zhin.js/plugin-runtime';
import { permissionHostToken } from '@zhin.js/permission';
import { checkDingtalkPlatformPermit } from './src/platform-permit.js';
import { dingtalkRuntimeStateToken } from './src/dingtalk-runtime-state.js';

export default definePlugin({
  name: 'dingtalk',
  metadata: {
    displayName: 'DingTalk (钉钉) Adapter',
  },
  setup(context) {
    context.resources.provide(dingtalkRuntimeStateToken, createEndpointRuntimeState());
    if (context.resources.has(permissionHostToken)) {
      const host = context.resources.use(permissionHostToken);
      return host.registerPlatform('dingtalk', checkDingtalkPlatformPermit);
    }
  },
});
