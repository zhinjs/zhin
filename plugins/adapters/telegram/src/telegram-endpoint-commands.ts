/**
 * `telegram endpoint` 命令族：由 @zhin.js/adapter 的 createEndpointCommands 套件生成。
 * commands/endpoint/ 下的 list / add / remove 直接默认导出这三项。
 */
import { createEndpointCommands } from '@zhin.js/adapter';
import { defineCommand } from '@zhin.js/command';
import { telegramRuntimeStateToken } from './telegram-runtime-state.js';

export const telegramEndpointCommands = createEndpointCommands({
  adapterKey: 'telegram',
  adapterDisplayName: 'Telegram',
  fields: [
    { key: 'token', required: true, env: true, description: 'Telegram bot token' },
  ],
  running: (use) => use(telegramRuntimeStateToken).endpoints.values(),
  describeEntry: (entry) => `token: ${String(entry.token)}`,
}, defineCommand);
