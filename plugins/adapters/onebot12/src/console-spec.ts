/**
 * OneBot 12 Console 页面元数据（浏览器与服务端共享；不要在这里 import 服务端代码）。
 */
import type { AdapterConsoleField } from 'zhin.js/adapter';

export const onebot12ConsoleSpec = {
  adapterKey: 'onebot12',
  adapterDisplayName: 'OneBot 12',
  fields: [
    { key: 'url', description: 'OneBot 实现 WebSocket URL（connection: ws 必填）', descriptionI18n: { en: 'OneBot WebSocket URL (required for connection: ws)' } },
    { key: 'path', description: 'HTTP/WS 路径（webhook / reverse-wss）', descriptionI18n: { en: 'HTTP/WS path (webhook / reverse-wss)' } },
    { key: 'api_url', description: 'HTTP action 端点（connection: webhook 出站必填）', descriptionI18n: { en: 'HTTP action endpoint (required for outbound connection: webhook)' } },
    { key: 'access_token', env: true, description: 'OneBot access token' },
  ] as readonly AdapterConsoleField[],
  docsUrl: 'https://zhin.js.org/adapters/onebot12',
  readPermission: 'onebot12:read',
  writePermission: 'onebot12:write',
} as const;
