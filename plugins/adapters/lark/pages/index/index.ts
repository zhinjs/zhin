import { definePage, createAdapterConsolePage } from '@zhin.js/console-contract';

export const meta = definePage({
  title: 'Lark',
  titleI18n: { en: 'Lark' },
  icon: 'Bird',
  order: 66,
  requiredPermissions: ['lark:read'],
  keywords: { 'zh-CN': ['飞书', '适配器', '连接'], en: ['feishu', 'adapter', 'connection'] },
});

/**
 * Convention page: `pages/index/index.ts` → `/lark`（插件路径）。
 * 连接状态、连接测试、endpoint 增删；登录待办来自 LoginAssist（ICQQ 等）。
 */
export default createAdapterConsolePage('lark');
