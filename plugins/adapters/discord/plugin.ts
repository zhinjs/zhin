import { definePlugin } from 'zhin.js';
import { permissionHostToken } from '@zhin.js/permission';
import { checkDiscordPlatformPermit } from './src/platform-permit.js';
import { createDiscordConsoleRpc } from './src/console.js';

export default definePlugin({
  name: 'discord',
  configUpdate: { featurePaths: [['nickname'], ['profile'], ['endpoints']] },
  metadata: {
    displayName: 'Discord Gateway Adapter',
  },
  setup(context) {
    const dispose = context.resources.has(permissionHostToken)
      ? context.resources.use(permissionHostToken).registerPlatform('discord', checkDiscordPlatformPermit)
      : undefined;
    return {
      consoleRpc: createDiscordConsoleRpc(() => context.config.get()),
      ...(dispose ? { dispose } : {}),
    };
  },
});
