import { definePage } from '@zhin.js/console-contract';
import { createAdapterConsolePage } from '@zhin.js/client';

export const meta = definePage({
  title: 'Milky',
  titleI18n: { en: 'Milky' },
  icon: 'Milk',
  order: 68,
  requiredPermissions: ['milky:read'],
});

/**
 * Convention page: `pages/index/index.ts` → `/milky`（插件路径）。
 * 连接状态、连接测试、endpoint 增删；登录待办来自 LoginAssist（ICQQ 等）。
 */
export default createAdapterConsolePage('milky');
