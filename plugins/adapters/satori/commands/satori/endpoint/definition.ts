/**
 * `satori endpoint` 命令族：由 @zhin.js/adapter 的 createEndpointCommands 套件生成。
 * commands/satori/endpoint/ 下的 list / add / remove 直接默认导出这三项。
 */
import { createEndpointCommands } from 'zhin.js/adapter';
import { defineCommand } from 'zhin.js/command';

export const satoriEndpointCommands = createEndpointCommands({
  adapterKey: 'satori',
  adapterDisplayName: 'Satori',
  fields: [
    { key: 'platform', required: true, description: 'Selected Satori login platform' },
    { key: 'userId', required: true, description: 'Selected Satori login user ID' },
    { key: 'baseUrl', required: true, description: 'Satori 服务 base URL', descriptionI18n: { en: "Satori service base URL" } },
    { key: 'path', description: 'webhook 路径（connection: webhook）', descriptionI18n: { en: "Webhook path (connection: webhook)" } },
    { key: 'token', env: true, description: 'Satori access token' },
  ],
  describeEntry: (entry) => `baseUrl: ${String(entry.baseUrl)}`,
}, defineCommand);
