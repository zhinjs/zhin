import { createEndpointRuntimeState } from '@zhin.js/adapter';
import { definePlugin } from '@zhin.js/plugin-runtime';
import { registerDefaultScenePlatformPermitChecker } from '@zhin.js/core';
import { onebot11RuntimeStateToken } from './src/onebot11-runtime-state.js';

export default definePlugin({
  name: 'onebot11',
  metadata: {
    displayName: 'OneBot 11 Adapter',
  },
  setup(context) {
    // 运行中 endpoint 注册表（onebot11.endpoint list 的"运行中"数据源）
    context.resources.provide(onebot11RuntimeStateToken, createEndpointRuntimeState());
    // 平台权限门禁：scene_admin / scene_owner 由 sender role 判定（见 ws/wss-endpoint admit metadata）
    return registerDefaultScenePlatformPermitChecker('onebot11');
  },
});
