/**
 * LINE Console 页面元数据（浏览器与服务端共享；不要在这里 import 服务端代码）。
 */
import type { AdapterConsoleField } from 'zhin.js/adapter';

export const lineConsoleSpec = {
  adapterKey: 'line',
  adapterDisplayName: 'LINE',
  fields: [
    { key: 'channelSecret', required: true, env: true, description: 'LINE channel secret' },
    { key: 'channelAccessToken', required: true, env: true, description: 'LINE channel access token' },
  ] as readonly AdapterConsoleField[],
  docsUrl: 'https://zhin.js.org/adapters/line',
  readPermission: 'line:read',
  writePermission: 'line:write',
} as const;
