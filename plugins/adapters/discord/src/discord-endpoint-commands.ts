/**
 * `discord.endpoint` 命令族：由 @zhin.js/adapter 的 createEndpointCommands 套件生成。
 * commands/endpoint/ 下的 list / add / remove 直接默认导出这三项。
 * 注：applicationId / publicKey 为顶层共享字段（slash commands / interactions 用），
 * endpoints[i] 仅需 name + token（见 schema.json），故 add 只录入 token。
 */
import { createEndpointCommands } from 'zhin.js/adapter';
import { defineCommand } from 'zhin.js/command';
import { discordRuntimeStateToken } from './discord-runtime-state.js';

export const discordEndpointCommands = createEndpointCommands({
  adapterKey: 'discord',
  adapterDisplayName: 'Discord',
  fields: [
    { key: 'token', required: true, env: true, description: 'Discord bot token' },
  ],
  running: (use) => use(discordRuntimeStateToken).endpoints.values(),
  describeEntry: (entry) => `token: ${String(entry.token)}`,
}, defineCommand);
