import { definePage } from '@zhin.js/console-contract';
import { createAdapterConsolePage } from '@zhin.js/client';

export const meta = definePage({
  title: 'LINE',
  titleI18n: { en: 'LINE' },
  icon: 'MessageCircle',
  order: 67,
  requiredPermissions: ['line:read'],
});

/**
 * Convention page: `pages/index/index.ts` → `/line`（插件路径）。
 * 连接状态、连接测试、endpoint 增删；登录待办来自 LoginAssist（ICQQ 等）。
 */
export default createAdapterConsolePage('line');
