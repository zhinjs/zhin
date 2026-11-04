import { definePage } from '@zhin.js/console-contract';
import { createAdapterConsolePage } from '@zhin.js/client';

export const meta = definePage({
  title: 'QQ',
  titleI18n: { en: 'QQ' },
  icon: 'MessageCircle',
  order: 60,
  requiredPermissions: ['qq:read'],
});

/**
 * Convention page: `pages/index/index.ts` → `/qq`（插件路径）。
 * 连接状态、测试、endpoint 增删、扫码绑定（原本 `qq endpoint add` 的聊天流程）。
 */
export default createAdapterConsolePage('qq');
