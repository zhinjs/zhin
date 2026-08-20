/**
 * `napcat.endpoint` 命令族：由 @zhin.js/adapter 的 createEndpointCommands 套件生成。
 * commands/endpoint/ 下的 list / add / remove 直接默认导出这三项。
 */
import { createEndpointCommands } from 'zhin.js/adapter';
import { defineCommand } from 'zhin.js/command';
import { napcatRuntimeStateToken } from './napcat-runtime-state.js';

export const napcatEndpointCommands = createEndpointCommands({
  adapterKey: 'napcat',
  adapterDisplayName: 'NapCat',
  fields: [
    { key: 'url', description: 'NapCat WebSocket URL（connection: ws 必填）' },
    { key: 'path', description: 'reverse-wss 路径（connection: wss）' },
    { key: 'http_url', description: 'HTTP API base URL（connection: http 出站）' },
    { key: 'post_path', description: 'HTTP POST 事件路径（connection: http 入站）' },
    { key: 'access_token', env: true, description: 'NapCat access token' },
  ],
  running: (use) => use(napcatRuntimeStateToken).endpoints.values(),
  describeEntry: (entry) => {
    if (entry.url) return `url: ${String(entry.url)}`;
    if (entry.path) return `path: ${String(entry.path)}`;
    if (entry.http_url) return `http_url: ${String(entry.http_url)}`;
    return '';
  },
}, defineCommand);
