/**
 * Satori Console 页面元数据（浏览器与服务端共享；不要在这里 import 服务端代码）。
 */
import type { AdapterConsoleField } from 'zhin.js/adapter';

export const satoriConsoleSpec = {
  adapterKey: 'satori',
  adapterDisplayName: 'Satori',
  fields: [
    { key: 'baseUrl', required: true, description: 'Satori 服务 base URL', descriptionI18n: { en: 'Satori service base URL' } },
    { key: 'path', description: 'webhook 路径（connection: webhook）', descriptionI18n: { en: 'Webhook path (connection: webhook)' } },
    { key: 'token', env: true, description: 'Satori access token' },
  ] as readonly AdapterConsoleField[],
  docsUrl: 'https://zhin.js.org/adapters/satori',
  readPermission: 'satori:read',
  writePermission: 'satori:write',
} as const;
