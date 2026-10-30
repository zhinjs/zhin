/**
 * OneBot 11 Console 页面元数据（浏览器与服务端共享；不要在这里 import 服务端代码）。
 */
import type { AdapterConsoleField } from 'zhin.js/adapter';

export const onebot11ConsoleSpec = {
  adapterKey: 'onebot11',
  adapterDisplayName: 'OneBot 11',
  fields: [
    { key: 'url', description: 'OneBot 实现 WebSocket URL（connection: ws 必填）', descriptionI18n: { en: 'OneBot WebSocket URL (required for connection: ws)' } },
    { key: 'path', description: 'reverse-wss 路径（connection: wss）', descriptionI18n: { en: 'Reverse WebSocket path (connection: wss)' } },
    { key: 'access_token', env: true, description: 'OneBot access token' },
  ] as readonly AdapterConsoleField[],
  docsUrl: 'https://zhin.js.org/adapters/onebot11',
  readPermission: 'onebot11:read',
  writePermission: 'onebot11:write',
} as const;
