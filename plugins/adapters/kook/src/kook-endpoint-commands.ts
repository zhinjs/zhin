/**
 * `kook.endpoint` 命令族：由 @zhin.js/adapter 的 createEndpointCommands 套件生成。
 * commands/endpoint/ 下的 list / add / remove 直接默认导出这三项。
 */
import { createEndpointCommands } from 'zhin.js/adapter';
import { defineCommand } from 'zhin.js/command';
import { kookRuntimeStateToken } from './kook-runtime-state.js';

export const kookEndpointCommands = createEndpointCommands({
  adapterKey: 'kook',
  adapterDisplayName: 'KOOK',
  fields: [
    { key: 'token', required: true, env: true, description: 'KOOK bot token' },
    { key: 'encrypt_key', env: true, description: 'webhook 加密密钥（connection: webhook）' },
    { key: 'verify_token', env: true, description: 'webhook 验证 token（connection: webhook）' },
  ],
  running: (use) => use(kookRuntimeStateToken).endpoints.values(),
  describeEntry: (entry) => `token: ${String(entry.token)}`,
}, defineCommand);
