import { definePlugin } from 'zhin.js';
import { permissionHostToken, createSceneRolePlatformChecker } from '@zhin.js/permission';
import { createOnebot11ConsoleRpc } from './src/console.js';

export default definePlugin({
  name: 'onebot11',
  configUpdate: { featurePaths: [['nickname'], ['profile'], ['endpoints']] },
  metadata: {
    displayName: 'OneBot 11 Adapter',
  },
  setup(context) {
    const dispose = context.resources.has(permissionHostToken)
      ? context.resources.use(permissionHostToken).registerPlatform('onebot11', createSceneRolePlatformChecker())
      : undefined;
    return {
      consoleRpc: createOnebot11ConsoleRpc(context.resources, () => context.config.get()),
      ...(dispose ? { dispose } : {}),
    };
  },
});
