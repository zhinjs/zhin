/**
 * `lark endpoint` 命令族：由 @zhin.js/adapter 的 createEndpointCommands 套件生成。
 * commands/lark/endpoint/ 下的 list / add / remove 直接默认导出这三项。
 */
import { createEndpointCommands } from 'zhin.js/adapter';
import { defineCommand } from 'zhin.js/command';
import { larkRuntimeStateToken } from '../../../src/lark-runtime-state.js';

export const larkEndpointCommands = createEndpointCommands({
  adapterKey: 'lark',
  adapterDisplayName: 'Lark',
  fields: [
    { key: 'appId', required: true, env: true, description: '飞书 App ID', descriptionI18n: { en: "Lark app ID" } },
    { key: 'appSecret', required: true, env: true, description: '飞书 App Secret', descriptionI18n: { en: "Lark app secret" } },
    { key: 'encryptKey', env: true, description: '事件加密 key', descriptionI18n: { en: "Event encryption key" } },
    { key: 'verificationToken', env: true, description: '事件验证 token', descriptionI18n: { en: "Event verification token" } },
  ],
  running: (use) => use(larkRuntimeStateToken).endpoints.values(),
  describeEntry: (entry) => `appId: ${String(entry.appId)}`,
}, defineCommand);
