/**
 * `line.endpoint` 命令族：由 @zhin.js/adapter 的 createEndpointCommands 套件生成。
 * commands/endpoint/ 下的 list / add / remove 直接默认导出这三项。
 */
import { createEndpointCommands } from '@zhin.js/adapter';
import { defineCommand } from '@zhin.js/command';
import { lineRuntimeStateToken } from './line-runtime-state.js';

export const lineEndpointCommands = createEndpointCommands({
  adapterKey: 'line',
  adapterDisplayName: 'LINE',
  fields: [
    { key: 'channelSecret', required: true, env: true, description: 'LINE channel secret' },
    { key: 'channelAccessToken', required: true, env: true, description: 'LINE channel access token' },
  ],
  running: (use) => use(lineRuntimeStateToken).endpoints.values(),
  describeEntry: (entry) => `channelAccessToken: ${String(entry.channelAccessToken)}`,
}, defineCommand);
