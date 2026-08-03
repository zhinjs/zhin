import { createEndpointRuntimeState } from '@zhin.js/adapter';
import { definePlugin } from '@zhin.js/plugin-runtime';
import { registerKookPlatformPermitChecker } from './src/platform-permit.js';
import { kookRuntimeStateToken } from './src/kook-runtime-state.js';

export default definePlugin({
  name: 'kook',
  metadata: {
    displayName: 'KOOK WebSocket Adapter',
  },
  setup(context) {
    // 运行中 endpoint 注册表（kook.endpoint list 的"运行中"数据源）
    context.resources.provide(kookRuntimeStateToken, createEndpointRuntimeState());
    // 平台权限门禁：guild_owner / guild_admin / channel_admin 等（agent 工具 platformPermit）
    return registerKookPlatformPermitChecker();
  },
});
