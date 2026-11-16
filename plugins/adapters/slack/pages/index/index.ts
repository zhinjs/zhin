import { definePage, createAdapterConsolePage } from '@zhin.js/console-contract';

export const meta = definePage({
  title: 'Slack',
  titleI18n: { en: 'Slack' },
  icon: 'Hash',
  order: 73,
  requiredPermissions: ['slack:read'],
  keywords: { 'zh-CN': ['工作区', '适配器', '连接'], en: ['workspace', 'adapter', 'connection'] },
});

/**
 * Convention page: `pages/index/index.ts` → `/slack`（插件路径）。
 * 连接状态、连接测试、endpoint 增删；登录待办来自 LoginAssist（ICQQ 等）。
 */
export default createAdapterConsolePage('slack');
