import { createEndpointRuntimeState } from '@zhin.js/adapter';
import { definePlugin } from '@zhin.js/plugin-runtime';
import { milkyRuntimeStateToken } from './src/milky-runtime-state.js';

export default definePlugin({
  name: 'milky',
  metadata: {
    displayName: 'Milky Adapter',
  },
  setup(context) {
    // 运行中 endpoint 注册表（milky endpoint list 的"运行中"数据源）
    context.resources.provide(milkyRuntimeStateToken, createEndpointRuntimeState());
  },
});
