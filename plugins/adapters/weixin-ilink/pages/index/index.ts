import { definePage } from '@zhin.js/console-contract';
import { createAdapterConsolePage } from '@zhin.js/client';

export const meta = definePage({
  title: '微信 iLink',
  titleI18n: { en: 'Weixin iLink' },
  icon: 'MessageCircle',
  order: 77,
  requiredPermissions: ['weixin-ilink:read'],
});

/**
 * Convention page: `pages/index/index.ts` → `/weixin-ilink`（插件路径）。
 * 连接状态、连接测试、endpoint 增删；登录待办来自 LoginAssist（ICQQ 等）。
 */
export default createAdapterConsolePage('weixin-ilink');
