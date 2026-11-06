import { definePlugin } from 'zhin.js';
import { permissionHostToken } from '@zhin.js/permission';
import { checkSlackPlatformPermit } from './src/platform-permit.js';
import { createSlackConsoleRpc } from './src/console.js';

export default definePlugin({
  name: 'slack',
  configUpdate: { featurePaths: [['nickname'], ['profile'], ['endpoints']] },
  metadata: {
    displayName: 'Slack Adapter',
  },
  setup(context) {
    const dispose = context.resources.has(permissionHostToken)
      ? context.resources.use(permissionHostToken).registerPlatform('slack', checkSlackPlatformPermit)
      : undefined;
    return {
      consoleRpc: createSlackConsoleRpc(() => context.config.get()),
      ...(dispose ? { dispose } : {}),
    };
  },
});
