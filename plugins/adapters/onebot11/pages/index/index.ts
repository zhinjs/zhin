import { definePage, createAdapterConsolePage } from '@zhin.js/console-contract';

export const meta = definePage({
  title: 'OneBot 11',
  titleI18n: { en: 'OneBot 11' },
  icon: 'Bot',
  order: 70,
  requiredPermissions: ['onebot11:read'],
  keywords: { 'zh-CN': ['OneBot v11', 'QQ', 'go-cqhttp'], en: ['onebot v11', 'qq', 'cqhttp'] },
});

/**
 * Convention page: `pages/index/index.ts` → `/onebot11`（插件路径）。
 * 连接状态、连接测试、endpoint 增删；登录待办来自 LoginAssist（ICQQ 等）。
 */
export default createAdapterConsolePage('onebot11');
