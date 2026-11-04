import { definePage } from '@zhin.js/console-contract';
import { createAdapterConsolePage } from '@zhin.js/client';

export const meta = definePage({
  title: 'DingTalk',
  titleI18n: { en: 'DingTalk' },
  icon: 'Building2',
  order: 61,
  requiredPermissions: ['dingtalk:read'],
});

/**
 * Convention page: `pages/index/index.ts` → `/dingtalk`（插件路径）。
 * 连接状态、连接测试、endpoint 增删；登录待办来自 LoginAssist（ICQQ 等）。
 */
export default createAdapterConsolePage('dingtalk');
