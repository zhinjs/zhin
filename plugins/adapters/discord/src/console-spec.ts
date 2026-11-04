/**
 * Discord Console 页面元数据（浏览器与服务端共享；不要在这里 import 服务端代码）。
 */
import type { AdapterConsoleField } from 'zhin.js/adapter';

export const discordConsoleSpec = {
  adapterKey: 'discord',
  adapterDisplayName: 'Discord',
  fields: [
    { key: 'token', required: true, env: true, description: 'Discord bot token' },
    { key: 'connection', description: 'gateway or interactions' },
    { key: 'applicationId', description: 'Application ID for Interactions; identity changes replace the account' },
    { key: 'publicKey', description: 'Application Ed25519 public key' },
    { key: 'interactionsPath', description: 'Local Interactions route' },
    { key: 'restApiProxy.port', type: 'number', description: 'Configured REST loopback proxy port' },
    { key: 'gatewayFaultProxyUrl', description: 'Configured local Gateway fault proxy URL' },
    { key: 'defaultActivity.name', description: 'SDK activity name' },
    { key: 'defaultActivity.type', description: 'PLAYING, STREAMING, LISTENING, WATCHING or COMPETING' },
    { key: 'defaultActivity.url', description: 'SDK activity URL' },
  ] as readonly AdapterConsoleField[],
  docsUrl: 'https://zhin.js.org/adapters/discord',
  readPermission: 'discord:read',
  writePermission: 'discord:write',
} as const;
