/**
 * Telegram Console 页面元数据（浏览器与服务端共享；不要在这里 import 服务端代码）。
 */
import type { AdapterConsoleField } from 'zhin.js/adapter';

export const telegramConsoleSpec = {
  adapterKey: 'telegram',
  adapterDisplayName: 'Telegram',
  fields: [
    { key: 'token', required: true, env: true, description: 'Telegram bot token' },
  ] as readonly AdapterConsoleField[],
  docsUrl: 'https://zhin.js.org/adapters/telegram',
  readPermission: 'telegram:read',
  writePermission: 'telegram:write',
} as const;
