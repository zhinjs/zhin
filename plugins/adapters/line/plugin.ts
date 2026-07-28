import { createEndpointRuntimeState } from '@zhin.js/adapter';
import { definePlugin } from '@zhin.js/plugin-runtime';
import { lineRuntimeStateToken } from './src/line-runtime-state.js';

export default definePlugin({
  name: 'line',
  metadata: {
    displayName: 'LINE Messaging API Adapter',
  },
  setup(context) {
    // 运行中 endpoint 注册表（line endpoint list 的"运行中"数据源）
    context.resources.provide(lineRuntimeStateToken, createEndpointRuntimeState());
  },
});
