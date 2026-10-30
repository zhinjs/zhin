import { createEndpointRuntimeState } from 'zhin.js/adapter';
import { definePlugin, pluginConsoleRpcToken } from 'zhin.js';
import { permissionHostToken, createSceneRolePlatformChecker } from '@zhin.js/permission';
import { icqqRuntimeStateToken } from './src/icqq-runtime-state.js';
import { icqqLoginControlToken } from './src/icqq-login-control.js';
import { createIcqqConsoleRpc } from './src/console.js';

export default definePlugin({
  name: 'icqq',
  metadata: {
    displayName: 'ICQQ Adapter',
  },
  setup(context) {
    // 运行中 endpoint 注册表（icqq endpoint list 的"运行中"数据源）
    context.resources.provide(icqqRuntimeStateToken, createEndpointRuntimeState());
    // 掉线恢复命令用：当前 generation 每个 UIN 的登录控制面
    context.resources.provide(icqqLoginControlToken, new Map());
    context.resources.provide(pluginConsoleRpcToken, createIcqqConsoleRpc(context.resources, () => context.config.get()));
    const disposePlatform = context.resources.has(permissionHostToken)
      ? context.resources.use(permissionHostToken).registerPlatform(
        'icqq',
        createSceneRolePlatformChecker(),
      )
      : undefined;
    return disposePlatform;
  },
});
