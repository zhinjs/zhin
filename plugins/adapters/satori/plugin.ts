import { createEndpointRuntimeState } from 'zhin.js/adapter';
import { definePlugin } from 'zhin.js';
import { satoriRuntimeStateToken } from './src/satori-runtime-state.js';

export default definePlugin({
  name: 'satori',
  metadata: {
    displayName: 'Satori Adapter',
  },
  setup(context) {
    // 运行中 endpoint 注册表（satori.endpoint list 的"运行中"数据源）
    context.resources.provide(satoriRuntimeStateToken, createEndpointRuntimeState());
  },
});
