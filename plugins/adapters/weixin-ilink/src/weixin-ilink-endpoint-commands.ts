/**
 * `weixin-ilink.endpoint` 命令族：由 @zhin.js/adapter 的 createEndpointCommands 套件生成。
 * commands/endpoint/ 下的 list / add / remove 直接默认导出这三项。
 */
import { createEndpointCommands } from 'zhin.js/adapter';
import { defineCommand } from 'zhin.js/command';
import { weixinIlinkRuntimeStateToken } from './weixin-ilink-runtime-state.js';

export const weixinIlinkEndpointCommands = createEndpointCommands({
  adapterKey: 'weixin-ilink',
  adapterDisplayName: 'Weixin iLink',
  fields: [
    { key: 'botToken', required: true, env: true, description: 'iLink bot token' },
  ],
  running: (use) => use(weixinIlinkRuntimeStateToken).endpoints.values(),
  describeEntry: (entry) => `botToken: ${String(entry.botToken)}`,
}, defineCommand);
