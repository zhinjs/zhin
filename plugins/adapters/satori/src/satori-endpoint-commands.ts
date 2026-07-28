/**
 * `satori endpoint` 命令族：由 @zhin.js/adapter 的 createEndpointCommands 套件生成。
 * commands/endpoint/ 下的 list / add / remove 直接默认导出这三项。
 */
import { createEndpointCommands } from '@zhin.js/adapter';
import { defineCommand } from '@zhin.js/command';
import { satoriRuntimeStateToken } from './satori-runtime-state.js';

export const satoriEndpointCommands = createEndpointCommands({
  adapterKey: 'satori',
  adapterDisplayName: 'Satori',
  fields: [
    { key: 'baseUrl', required: true, description: 'Satori 服务 base URL' },
    { key: 'path', description: 'webhook 路径（connection: webhook）' },
    { key: 'token', env: true, description: 'Satori access token' },
  ],
  running: (use) => use(satoriRuntimeStateToken).endpoints.values(),
  describeEntry: (entry) => `baseUrl: ${String(entry.baseUrl)}`,
}, defineCommand);
