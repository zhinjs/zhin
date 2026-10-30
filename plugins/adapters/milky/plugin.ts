import { createEndpointRuntimeState } from 'zhin.js/adapter';
import { definePlugin, pluginConsoleRpcToken } from 'zhin.js';
import { milkyRuntimeStateToken } from './src/milky-runtime-state.js';
import { createMilkyConsoleRpc } from './src/console.js';

export default definePlugin({
  name: 'milky',
  metadata: {
    displayName: 'Milky Adapter',
  },
  setup(context) {
    // 运行中 endpoint 注册表（milky endpoint list 的"运行中"数据源）
    context.resources.provide(milkyRuntimeStateToken, createEndpointRuntimeState());
    context.resources.provide(pluginConsoleRpcToken, createMilkyConsoleRpc(context.resources, () => context.config.get()));
  },
});
