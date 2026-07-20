import { definePlugin } from '@zhin.js/plugin-runtime';
import { registerDefaultScenePlatformPermitChecker } from '@zhin.js/core';

export default definePlugin({
  name: 'onebot11',
  metadata: {
    displayName: 'OneBot 11 Adapter',
  },
  setup() {
    // 平台权限门禁：scene_admin / scene_owner 由 sender role 判定（见 ws/wss-endpoint admit metadata）
    return registerDefaultScenePlatformPermitChecker('onebot11');
  },
});
