/**
 * NapCat Console 页面元数据（浏览器与服务端共享；不要在这里 import 服务端代码）。
 */
import type { AdapterConsoleField } from 'zhin.js/adapter';

export const napcatConsoleSpec = {
  adapterKey: 'napcat',
  adapterDisplayName: 'NapCat',
  fields: [
    { key: 'url', description: 'NapCat WebSocket URL（connection: ws 必填）', descriptionI18n: { en: 'NapCat WebSocket URL (required for connection: ws)' } },
    { key: 'path', description: 'reverse-wss 路径（connection: wss）', descriptionI18n: { en: 'Reverse WebSocket path (connection: wss)' } },
    { key: 'http_url', description: 'HTTP API base URL（connection: http 出站）', descriptionI18n: { en: 'HTTP API base URL (outbound connection: http)' } },
    { key: 'post_path', description: 'HTTP POST 事件路径（connection: http 入站）', descriptionI18n: { en: 'HTTP POST event path (inbound connection: http)' } },
    { key: 'access_token', env: true, description: 'NapCat access token' },
  ] as readonly AdapterConsoleField[],
  docsUrl: 'https://zhin.js.org/adapters/napcat',
  readPermission: 'napcat:read',
  writePermission: 'napcat:write',
} as const;
