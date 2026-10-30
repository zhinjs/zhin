/**
 * Discord Console 页面元数据（浏览器与服务端共享；不要在这里 import 服务端代码）。
 */
import type { AdapterConsoleField } from 'zhin.js/adapter';

export const discordConsoleSpec = {
  adapterKey: 'discord',
  adapterDisplayName: 'Discord',
  fields: [
    { key: 'token', required: true, env: true, description: 'Discord bot token' },
  ] as readonly AdapterConsoleField[],
  docsUrl: 'https://zhin.js.org/adapters/discord',
  readPermission: 'discord:read',
  writePermission: 'discord:write',
} as const;
