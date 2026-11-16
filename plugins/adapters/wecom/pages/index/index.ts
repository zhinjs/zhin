import { definePage, createAdapterConsolePage } from '@zhin.js/console-contract';

export const meta = definePage({
  title: '企业微信',
  titleI18n: { en: 'WeCom' },
  icon: 'Building',
  order: 76,
  requiredPermissions: ['wecom:read'],
  keywords: { 'zh-CN': ['企微', '企业微信机器人', '适配器'], en: ['wechat work', 'enterprise wechat', 'adapter'] },
});

/**
 * Convention page: `pages/index/index.ts` → `/wecom`（插件路径）。
 * 连接状态、连接测试、endpoint 增删；登录待办来自 LoginAssist（ICQQ 等）。
 */
export default createAdapterConsolePage('wecom');
