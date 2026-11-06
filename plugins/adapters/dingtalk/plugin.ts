import { definePlugin } from 'zhin.js';
import { permissionHostToken } from '@zhin.js/permission';
import { checkDingtalkPlatformPermit } from './src/platform-permit.js';
import { createDingtalkConsoleRpc } from './src/console.js';

export default definePlugin({
  name: 'dingtalk',
  configUpdate: { featurePaths: [['nickname'], ['profile'], ['endpoints']] },
  metadata: {
    displayName: 'DingTalk (钉钉) Adapter',
  },
  setup(context) {
    const dispose = context.resources.has(permissionHostToken)
      ? context.resources.use(permissionHostToken).registerPlatform('dingtalk', checkDingtalkPlatformPermit)
      : undefined;
    return {
      consoleRpc: createDingtalkConsoleRpc(context.resources, () => context.config.get()),
      ...(dispose ? { dispose } : {}),
    };
  },
});
