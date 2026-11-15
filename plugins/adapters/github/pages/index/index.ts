import { definePage, createAdapterConsolePage } from '@zhin.js/console-contract';

export const meta = definePage({
  title: 'GitHub',
  titleI18n: { en: 'GitHub' },
  icon: 'Github',
  order: 63,
  requiredPermissions: ['github:read'],
  keywords: { 'zh-CN': ['Webhook', 'GitHub App', 'Issue', 'PR'], en: ['webhook', 'github app', 'issues', 'pull requests'] },
});

/**
 * Convention page: `pages/index/index.ts` → `/github`（插件路径）。
 * 连接状态、连接测试、endpoint 增删；登录待办来自 LoginAssist（ICQQ 等）。
 */
export default createAdapterConsolePage('github');
