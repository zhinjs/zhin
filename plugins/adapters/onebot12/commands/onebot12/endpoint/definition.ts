/**
 * `onebot12 endpoint` 命令族：由 @zhin.js/adapter 的 createEndpointCommands 套件生成。
 * commands/onebot12/endpoint/ 下的 list / add / remove 直接默认导出这三项。
 */
import { createEndpointCommands } from 'zhin.js/adapter';
import { defineCommand } from 'zhin.js/command';

export const onebot12EndpointCommands = createEndpointCommands({
  adapterKey: 'onebot12',
  adapterDisplayName: 'OneBot 12',
  fields: [
    { key: 'platform', required: true, description: 'Selected OneBot12 bot platform' },
    { key: 'userId', required: true, description: 'Selected OneBot12 bot user ID' },
    { key: 'url', description: 'OneBot 实现 WebSocket URL（connection: ws 必填）', descriptionI18n: { en: "OneBot WebSocket URL (required for connection: ws)" } },
    { key: 'path', description: 'HTTP/WS 路径（webhook / reverse-wss）', descriptionI18n: { en: "HTTP/WS path (webhook / reverse-wss)" } },
    { key: 'api_url', description: 'HTTP action 端点（connection: webhook 出站必填）', descriptionI18n: { en: "HTTP action endpoint (required for outbound connection: webhook)" } },
    { key: 'access_token', env: true, description: 'OneBot access token' },
  ],
  describeEntry: (entry) => {
    if (entry.url) return `url: ${String(entry.url)}`;
    if (entry.path) return `path: ${String(entry.path)}`;
    return '';
  },
}, defineCommand);
