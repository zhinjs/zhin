import { definePage, createAdapterConsolePage } from '@zhin.js/console-contract';

export const meta = definePage({
  title: 'Telegram',
  titleI18n: { en: 'Telegram' },
  icon: 'Send',
  order: 74,
  requiredPermissions: ['telegram:read'],
  keywords: { 'zh-CN': ['电报', 'TG', '适配器'], en: ['tg', 'bot api', 'adapter'] },
});

/**
 * Convention page: `pages/index/index.ts` → `/telegram`（插件路径）。
 * 连接状态、连接测试、endpoint 增删；登录待办来自 LoginAssist（ICQQ 等）。
 */
export default createAdapterConsolePage('telegram');
