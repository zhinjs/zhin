/**
 * `milky endpoint` 命令族：由 @zhin.js/adapter 的 createEndpointCommands 套件生成。
 * commands/milky/endpoint/ 下的 list / add / remove 直接默认导出这三项。
 */
import { createEndpointCommands } from 'zhin.js/adapter';
import { defineCommand } from 'zhin.js/command';

export const milkyEndpointCommands = createEndpointCommands({
  adapterKey: 'milky',
  adapterDisplayName: 'Milky',
  fields: [
    { key: 'baseUrl', required: true, description: 'Milky HTTP API base URL' },
    { key: 'path', description: 'webhook / reverse-wss 路径', descriptionI18n: { en: "Webhook / reverse-wss path" } },
    { key: 'access_token', env: true, description: 'Milky access token' },
  ],
  describeEntry: (entry) => `baseUrl: ${String(entry.baseUrl)}`,
}, defineCommand);
