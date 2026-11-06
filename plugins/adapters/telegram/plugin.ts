import { definePlugin } from 'zhin.js';
import { permissionHostToken } from '@zhin.js/permission';
import { checkTelegramPlatformPermit } from './src/platform-permit.js';
import { createTelegramConsoleRpc } from './src/console.js';

export default definePlugin({
  name: 'telegram',
  configUpdate: { featurePaths: [['nickname'], ['profile'], ['endpoints']] },
  metadata: {
    displayName: 'Telegram Bot API Adapter',
  },
  setup(context) {
    const dispose = context.resources.has(permissionHostToken)
      ? context.resources.use(permissionHostToken).registerPlatform('telegram', checkTelegramPlatformPermit)
      : undefined;
    return {
      consoleRpc: createTelegramConsoleRpc(() => context.config.get()),
      ...(dispose ? { dispose } : {}),
    };
  },
});
