import { definePlugin, pluginConsoleRpcToken } from 'zhin.js';
import { permissionHostToken } from '@zhin.js/permission';
import { checkDingtalkPlatformPermit } from './src/platform-permit.js';
import { createDingtalkConsoleRpc } from './src/console.js';

export default definePlugin({
  name: 'dingtalk',
  metadata: {
    displayName: 'DingTalk (钉钉) Adapter',
  },
  setup(context) {
    context.resources.provide(pluginConsoleRpcToken, createDingtalkConsoleRpc(context.resources, () => context.config.get()));
    if (context.resources.has(permissionHostToken)) {
      const host = context.resources.use(permissionHostToken);
      return host.registerPlatform('dingtalk', checkDingtalkPlatformPermit);
    }
  },
});
