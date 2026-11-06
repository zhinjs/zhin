import { definePlugin } from 'zhin.js';
import { permissionHostToken } from '@zhin.js/permission';
import { checkWecomPlatformPermit } from './src/platform-permit.js';
import { createWecomConsoleRpc } from './src/console.js';

export default definePlugin({
  name: 'wecom',
  configUpdate: { featurePaths: [['nickname'], ['profile'], ['endpoints']] },
  metadata: {
    displayName: 'WeCom (企业微信) Adapter',
  },
  setup(context) {
    const dispose = context.resources.has(permissionHostToken)
      ? context.resources.use(permissionHostToken).registerPlatform('wecom', checkWecomPlatformPermit)
      : undefined;
    return {
      consoleRpc: createWecomConsoleRpc(context.resources, () => context.config.get()),
      ...(dispose ? { dispose } : {}),
    };
  },
});
