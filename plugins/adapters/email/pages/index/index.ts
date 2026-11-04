import { definePage } from '@zhin.js/console-contract';
import { createAdapterConsolePage } from '@zhin.js/client';

export const meta = definePage({
  title: 'Email',
  titleI18n: { en: 'Email' },
  icon: 'Mail',
  order: 79,
  requiredPermissions: ['email:read'],
});

/**
 * Convention page: `pages/index/index.ts` → `/email`（插件路径）。
 * 连接状态、测试与只读 endpoint 列表；SMTP/IMAP 配置在配置文件里修改。
 */
export default createAdapterConsolePage('email');
