/**
 * `milky.endpoint` 命令族：由 @zhin.js/adapter 的 createEndpointCommands 套件生成。
 * commands/endpoint/ 下的 list / add / remove 直接默认导出这三项。
 */
import { createEndpointCommands } from 'zhin.js/adapter';
import { defineCommand } from 'zhin.js/command';
import { milkyRuntimeStateToken } from './milky-runtime-state.js';

export const milkyEndpointCommands = createEndpointCommands({
  adapterKey: 'milky',
  adapterDisplayName: 'Milky',
  fields: [
    { key: 'baseUrl', required: true, description: 'Milky HTTP API base URL' },
    { key: 'path', description: 'webhook / reverse-wss 路径' },
    { key: 'access_token', env: true, description: 'Milky access token' },
  ],
  running: (use) => use(milkyRuntimeStateToken).endpoints.values(),
  describeEntry: (entry) => `baseUrl: ${String(entry.baseUrl)}`,
}, defineCommand);
