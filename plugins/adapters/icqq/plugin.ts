import { definePlugin, pluginConsoleRpcToken } from 'zhin.js';
import { permissionHostToken, createSceneRolePlatformChecker } from '@zhin.js/permission';
import { registerSensitiveExecCommand } from '@zhin.js/agent';
import { createIcqqConsoleRpc } from './src/console.js';
import { icqqSensitiveExecRule } from './src/sensitive-commands.js';

export default definePlugin({
  name: 'icqq',
  configUpdate: { featurePaths: [['nickname'], ['profile'], ['endpoints']] },
  metadata: {
    displayName: 'ICQQ Adapter',
  },
  setup(context) {
    context.resources.provide(pluginConsoleRpcToken, createIcqqConsoleRpc(() => context.config.get()));
    const disposePlatform = context.resources.has(permissionHostToken)
      ? context.resources.use(permissionHostToken).registerPlatform(
        'icqq',
        createSceneRolePlatformChecker(),
      )
      : undefined;
    const disposeExecRule = registerSensitiveExecCommand(icqqSensitiveExecRule);
    return () => {
      disposeExecRule();
      disposePlatform?.();
    };
  },
});
