import { definePage, createAdapterConsolePage } from '@zhin.js/console-contract';

export const meta = definePage({
  title: '微信 iPad',
  titleI18n: { en: 'iPad WeChat' },
  icon: 'MessageCircle',
  order: 78,
  requiredPermissions: ['ipad-wechat:read'],
  keywords: { 'zh-CN': ['微信', '个人微信', 'iPad'], en: ['wechat', 'weixin', 'ipad'] },
});

/**
 * Convention page: `pages/index/index.ts` → `/ipad-wechat`（插件路径）。
 * 连接状态、连接测试、endpoint 增删；扫码与设备验证在登录面板（LoginAssist）。
 */
export default createAdapterConsolePage('ipad-wechat');
