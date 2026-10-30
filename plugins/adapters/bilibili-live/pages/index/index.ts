import { definePage } from '@zhin.js/console-contract';
import { createAdapterConsolePage } from '@zhin.js/client';

export const meta = definePage({
  title: 'Bilibili 直播弹幕',
  titleI18n: { en: 'Bilibili Live' },
  icon: 'Radio',
  order: 78,
  requiredPermissions: ['bilibili-live:read'],
});

/**
 * Convention page: `pages/index/index.ts` → `/bilibili-live`（插件路径）。
 * 弹幕连接状态、测试与 endpoint 增删（扫码登录仍复用 B 站评论页）。
 */
export default createAdapterConsolePage('bilibili-live');
