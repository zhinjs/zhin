import { definePage } from '@zhin.js/console-contract';
import { createAdapterConsolePage } from '@zhin.js/client';

export const meta = definePage({
  title: 'Satori',
  titleI18n: { en: 'Satori' },
  icon: 'Sparkles',
  order: 72,
  requiredPermissions: ['satori:read'],
});

/**
 * Convention page: `pages/index/index.ts` → `/satori`（插件路径）。
 * 连接状态、连接测试、endpoint 增删；登录待办来自 LoginAssist（ICQQ 等）。
 */
export default createAdapterConsolePage('satori');
