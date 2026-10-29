import { createEndpointRuntimeState } from 'zhin.js/adapter';
import { definePlugin } from 'zhin.js';
import { permissionHostToken, createSceneRolePlatformChecker } from '@zhin.js/permission';
import { registerSensitiveExecCommand } from '@zhin.js/agent';
import { icqqSensitiveExecRule } from './src/sensitive-commands.js';
import { icqqRuntimeStateToken } from './src/icqq-runtime-state.js';

export default definePlugin({
  name: 'icqq',
  metadata: {
    displayName: 'ICQQ Adapter',
  },
  setup(context) {
    // 运行中 endpoint 注册表（icqq endpoint list 的"运行中"数据源）
    context.resources.provide(icqqRuntimeStateToken, createEndpointRuntimeState());
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
