import { definePlugin } from '@zhin.js/plugin-runtime';
import { registerQqPlatformPermitChecker } from './src/platform-permit.js';
import { createQqRuntimeState, qqRuntimeStateToken } from './src/qq-runtime-state.js';

export default definePlugin({
  name: 'qq',
  metadata: {
    displayName: 'QQ Official WebSocket Adapter',
  },
  setup(context) {
    // 运行中 endpoint 注册表 + 扫码绑定单例，供 adapter create 与 `qq endpoint` 命令共享
    context.resources.provide(qqRuntimeStateToken, createQqRuntimeState());
    // 平台权限门禁：guild_owner / guild_admin / manage_roles / manage_channels（agent 工具 platformPermit）
    return registerQqPlatformPermitChecker();
  },
});
