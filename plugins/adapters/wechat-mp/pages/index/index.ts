import { definePage } from '@zhin.js/console-contract';
import { createAdapterConsolePage } from '@zhin.js/client';

export const meta = definePage({
  title: '微信公众号',
  titleI18n: { en: 'WeChat MP' },
  icon: 'MessageSquare',
  order: 75,
  requiredPermissions: ['wechat-mp:read'],
});

/**
 * Convention page: `pages/index/index.ts` → `/wechat-mp`（插件路径）。
 * 连接状态、连接测试、endpoint 增删；登录待办来自 LoginAssist（ICQQ 等）。
 */
export default createAdapterConsolePage('wechat-mp');
