/**
 * Lark Console 页面元数据（浏览器与服务端共享；不要在这里 import 服务端代码）。
 */
import type { AdapterConsoleField } from 'zhin.js/adapter';

export const larkConsoleSpec = {
  adapterKey: 'lark',
  adapterDisplayName: 'Lark',
  fields: [
    { key: 'appId', required: true, env: true, description: '飞书 App ID', descriptionI18n: { en: 'Lark app ID' } },
    { key: 'appSecret', required: true, env: true, description: '飞书 App Secret', descriptionI18n: { en: 'Lark app secret' } },
    { key: 'encryptKey', env: true, description: '事件加密 key', descriptionI18n: { en: 'Event encryption key' } },
    { key: 'verificationToken', env: true, description: '事件验证 token', descriptionI18n: { en: 'Event verification token' } },
  ] as readonly AdapterConsoleField[],
  docsUrl: 'https://zhin.js.org/adapters/lark',
  readPermission: 'lark:read',
  writePermission: 'lark:write',
} as const;
