/**
 * Milky Console 页面元数据（浏览器与服务端共享；不要在这里 import 服务端代码）。
 */
import type { AdapterConsoleField } from 'zhin.js/adapter';

export const milkyConsoleSpec = {
  adapterKey: 'milky',
  adapterDisplayName: 'Milky',
  fields: [
    { key: 'baseUrl', required: true, description: 'Milky HTTP API base URL' },
    { key: 'path', description: 'webhook / reverse-wss 路径', descriptionI18n: { en: 'Webhook / reverse-wss path' } },
    { key: 'access_token', env: true, description: 'Milky access token' },
  ] as readonly AdapterConsoleField[],
  docsUrl: 'https://zhin.js.org/adapters/milky',
  readPermission: 'milky:read',
  writePermission: 'milky:write',
} as const;
