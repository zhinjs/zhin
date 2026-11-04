import { definePage } from '@zhin.js/console-contract';
import { createAdapterConsolePage } from '@zhin.js/client';

export const meta = definePage({
  title: 'OneBot 12',
  titleI18n: { en: 'OneBot 12' },
  icon: 'Bot',
  order: 71,
  requiredPermissions: ['onebot12:read'],
});

/**
 * Convention page: `pages/index/index.ts` → `/onebot12`（插件路径）。
 * 连接状态、连接测试、endpoint 增删；登录待办来自 LoginAssist（ICQQ 等）。
 */
export default createAdapterConsolePage('onebot12');
