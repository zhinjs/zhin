import { createEndpointRuntimeState } from 'zhin.js/adapter';
import { definePlugin } from 'zhin.js';
import { onebot12RuntimeStateToken } from './src/onebot12-runtime-state.js';

export default definePlugin({
  name: 'onebot12',
  metadata: {
    displayName: 'OneBot 12 Adapter',
  },
  setup(context) {
    // 运行中 endpoint 注册表（onebot12.endpoint list 的"运行中"数据源）
    context.resources.provide(onebot12RuntimeStateToken, createEndpointRuntimeState());
  },
});
