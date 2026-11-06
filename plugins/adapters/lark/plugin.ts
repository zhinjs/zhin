import { definePlugin } from 'zhin.js';
import { permissionHostToken } from '@zhin.js/permission';
import { checkLarkPlatformPermit } from './src/platform-permit.js';
import { createLarkConsoleRpc } from './src/console.js';

export default definePlugin({
  name: 'lark',
  configUpdate: { featurePaths: [['nickname'], ['profile'], ['endpoints']] },
  metadata: {
    displayName: 'Lark/Feishu (飞书) Adapter',
  },
  setup(context) {
    const dispose = context.resources.has(permissionHostToken)
      ? context.resources.use(permissionHostToken).registerPlatform('lark', checkLarkPlatformPermit)
      : undefined;
    return {
      consoleRpc: createLarkConsoleRpc(context.resources, () => context.config.get()),
      ...(dispose ? { dispose } : {}),
    };
  },
});
