import { definePlugin } from '@zhin.js/plugin-runtime';
import { registerDefaultScenePlatformPermitChecker } from '@zhin.js/core';

export default definePlugin({
  name: 'napcat',
  metadata: {
    displayName: 'NapCat Adapter',
  },
  setup() {
    // 平台权限门禁：scene_admin / scene_owner 由 sender role 判定（见各 endpoint admit metadata）
    return registerDefaultScenePlatformPermitChecker('napcat');
  },
});
