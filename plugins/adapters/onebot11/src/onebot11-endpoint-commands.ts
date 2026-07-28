/**
 * `onebot11 endpoint` 命令族：由 @zhin.js/adapter 的 createEndpointCommands 套件生成。
 * commands/endpoint/ 下的 list / add / remove 直接默认导出这三项。
 */
import { createEndpointCommands } from '@zhin.js/adapter';
import { defineCommand } from '@zhin.js/command';
import { onebot11RuntimeStateToken } from './onebot11-runtime-state.js';

export const onebot11EndpointCommands = createEndpointCommands({
  adapterKey: 'onebot11',
  adapterDisplayName: 'OneBot 11',
  fields: [
    { key: 'url', description: 'OneBot 实现 WebSocket URL（connection: ws 必填）' },
    { key: 'path', description: 'reverse-wss 路径（connection: wss）' },
    { key: 'access_token', env: true, description: 'OneBot access token' },
  ],
  running: (use) => use(onebot11RuntimeStateToken).endpoints.values(),
  describeEntry: (entry) => {
    if (entry.url) return `url: ${String(entry.url)}`;
    if (entry.path) return `path: ${String(entry.path)}`;
    return '';
  },
}, defineCommand);
