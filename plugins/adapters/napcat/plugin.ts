import { createEndpointRuntimeState } from '@zhin.js/adapter';
import { definePlugin } from '@zhin.js/plugin-runtime';
import { registerDefaultScenePlatformPermitChecker } from '@zhin.js/core';
import { napcatRuntimeStateToken } from './src/napcat-runtime-state.js';

export default definePlugin({
  name: 'napcat',
  metadata: {
    displayName: 'NapCat Adapter',
  },
  setup(context) {
    // 运行中 endpoint 注册表（napcat endpoint list 的"运行中"数据源）
    context.resources.provide(napcatRuntimeStateToken, createEndpointRuntimeState());
    // 平台权限门禁：scene_admin / scene_owner 由 sender role 判定（见各 endpoint admit metadata）
    return registerDefaultScenePlatformPermitChecker('napcat');
  },
});
