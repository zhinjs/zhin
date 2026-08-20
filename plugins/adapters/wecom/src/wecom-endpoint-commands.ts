/**
 * `wecom.endpoint` 命令族：由 @zhin.js/adapter 的 createEndpointCommands 套件生成。
 * commands/endpoint/ 下的 list / add / remove 直接默认导出这三项。
 */
import { createEndpointCommands } from 'zhin.js/adapter';
import { defineCommand } from 'zhin.js/command';
import { wecomRuntimeStateToken } from './wecom-runtime-state.js';

export const wecomEndpointCommands = createEndpointCommands({
  adapterKey: 'wecom',
  adapterDisplayName: 'WeCom',
  fields: [
    { key: 'corpId', required: true, env: true, description: '企业 corpId' },
    { key: 'agentSecret', required: true, env: true, description: '应用 secret' },
    { key: 'token', required: true, env: true, description: '回调 token' },
    { key: 'encodingAESKey', required: true, env: true, description: '回调加解密 key' },
  ],
  running: (use) => use(wecomRuntimeStateToken).endpoints.values(),
  describeEntry: (entry) => `corpId: ${String(entry.corpId)}`,
}, defineCommand);
