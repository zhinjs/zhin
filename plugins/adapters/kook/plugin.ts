import { definePlugin } from 'zhin.js';
import { permissionHostToken } from '@zhin.js/permission';
import { checkKookPlatformPermit } from './src/platform-permit.js';
import { createKookConsoleRpc } from './src/console.js';

export default definePlugin({
  name: 'kook',
  configUpdate: { featurePaths: [['nickname'], ['profile'], ['endpoints']] },
  metadata: {
    displayName: 'KOOK WebSocket Adapter',
  },
  setup(context) {
    const dispose = context.resources.has(permissionHostToken)
      ? context.resources.use(permissionHostToken).registerPlatform('kook', checkKookPlatformPermit)
      : undefined;
    return {
      consoleRpc: createKookConsoleRpc(() => context.config.get()),
      ...(dispose ? { dispose } : {}),
    };
  },
});
