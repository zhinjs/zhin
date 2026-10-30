/**
 * Telegram Console 页面元数据（浏览器与服务端共享；不要在这里 import 服务端代码）。
 */
import type { AdapterConsoleField } from 'zhin.js/adapter';

export const telegramConsoleSpec = {
  adapterKey: 'telegram',
  adapterDisplayName: 'Telegram',
  fields: [
    { key: 'token', required: true, env: true, description: 'Telegram bot token' },
    { key: 'apiBaseUrl', description: 'Telegram Bot API URL' },
    { key: 'polling', type: 'boolean', description: 'Use long polling; false selects webhook mode' },
    { key: 'webhook.domain', description: 'Public webhook origin' },
    { key: 'webhook.path', description: 'Local webhook route' },
    { key: 'webhook.secretToken', env: true, description: 'Webhook secret token' },
  ] as readonly AdapterConsoleField[],
  docsUrl: 'https://zhin.js.org/adapters/telegram',
  readPermission: 'telegram:read',
  writePermission: 'telegram:write',
} as const;
