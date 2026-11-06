import { definePlugin } from 'zhin.js';
import { permissionHostToken, createSceneRolePlatformChecker } from '@zhin.js/permission';
import { createNapcatConsoleRpc } from './src/console.js';

export default definePlugin({
  name: 'napcat',
  configUpdate: { featurePaths: [['nickname'], ['profile'], ['endpoints']] },
  metadata: {
    displayName: 'NapCat Adapter',
  },
  setup(context) {
    const dispose = context.resources.has(permissionHostToken)
      ? context.resources.use(permissionHostToken).registerPlatform('napcat', createSceneRolePlatformChecker())
      : undefined;
    return {
      consoleRpc: createNapcatConsoleRpc(context.resources, () => context.config.get()),
      ...(dispose ? { dispose } : {}),
    };
  },
});
