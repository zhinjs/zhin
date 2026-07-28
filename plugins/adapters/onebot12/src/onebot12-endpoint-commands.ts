/**
 * `onebot12 endpoint` 命令族：由 @zhin.js/adapter 的 createEndpointCommands 套件生成。
 * commands/endpoint/ 下的 list / add / remove 直接默认导出这三项。
 */
import { createEndpointCommands } from '@zhin.js/adapter';
import { defineCommand } from '@zhin.js/command';
import { onebot12RuntimeStateToken } from './onebot12-runtime-state.js';

export const onebot12EndpointCommands = createEndpointCommands({
  adapterKey: 'onebot12',
  adapterDisplayName: 'OneBot 12',
  fields: [
    { key: 'url', description: 'OneBot 实现 WebSocket URL（connection: ws 必填）' },
    { key: 'path', description: 'HTTP/WS 路径（webhook / reverse-wss）' },
    { key: 'api_url', description: 'HTTP action 端点（connection: webhook 出站必填）' },
    { key: 'access_token', env: true, description: 'OneBot access token' },
  ],
  running: (use) => use(onebot12RuntimeStateToken).endpoints.values(),
  describeEntry: (entry) => {
    if (entry.url) return `url: ${String(entry.url)}`;
    if (entry.path) return `path: ${String(entry.path)}`;
    return '';
  },
}, defineCommand);
