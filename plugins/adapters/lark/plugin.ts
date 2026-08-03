import { createEndpointRuntimeState } from '@zhin.js/adapter';
import { definePlugin } from '@zhin.js/plugin-runtime';
import { registerLarkPlatformPermitChecker } from './src/platform-permit.js';
import { larkRuntimeStateToken } from './src/lark-runtime-state.js';

export default definePlugin({
  name: 'lark',
  metadata: {
    displayName: 'Lark/Feishu (飞书) Adapter',
  },
  setup(context) {
    // 运行中 endpoint 注册表（lark.endpoint list 的"运行中"数据源）
    context.resources.provide(larkRuntimeStateToken, createEndpointRuntimeState());
    return registerLarkPlatformPermitChecker();
  },
});
