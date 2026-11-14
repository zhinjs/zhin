/**
 * Sandbox Console RPC (#1250): status plus the shared endpoint management — add, start, stop and
 * remove Sandbox accounts from the Console like every other adapter (`createAdapterConsoleRpc`).
 *
 * The plugin's own page (`pages/index`, the conversation workbench) carries the RPC; the Console's
 * account view renders the shared adapter account panel from `status`.
 */
import { createAdapterConsoleRpc, type AdapterConsoleField } from 'zhin.js/adapter';
import type { PluginConsoleRpc } from 'zhin.js';

export const sandboxConsoleFields: readonly AdapterConsoleField[] = Object.freeze([
  {
    key: 'owner',
    label: '所有者用户 ID',
    labelI18n: { en: 'Owner user ID' },
    placeholder: 'sandbox-user',
    description: 'Console 里以这个用户身份发消息；不填时使用适配器的默认值',
    descriptionI18n: { en: 'The Console chats as this user; the adapter default is used when empty' },
  },
  {
    key: 'nickname',
    label: '机器人昵称',
    labelI18n: { en: 'Bot nickname' },
    description: '会话里显示的机器人名字（可选）',
    descriptionI18n: { en: 'Bot name shown in conversations (optional)' },
  },
  {
    key: 'commandPrefix',
    label: '命令前缀',
    labelI18n: { en: 'Command prefix' },
    placeholder: '/',
    description: '只把以它开头的消息当作命令；留空时任意文本都按命令匹配',
    descriptionI18n: { en: 'Only messages starting with it are commands; empty matches any text' },
  },
]);

export const sandboxConsoleSpec = Object.freeze({
  adapterKey: 'sandbox',
  adapterDisplayName: 'Sandbox',
  fields: sandboxConsoleFields,
  docsUrl: 'https://zhin.js.org/adapters/sandbox',
  readPermission: 'sandbox:read',
  writePermission: 'sandbox:write',
  idHint: '账号名，例如 sandbox-bot',
  idHintI18n: { en: 'Account name, e.g. sandbox-bot' },
});

export function createSandboxConsoleRpc(getConfig: () => unknown): PluginConsoleRpc {
  return createAdapterConsoleRpc({ ...sandboxConsoleSpec, getConfig });
}
