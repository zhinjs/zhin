/**
 * KOOK Console 页面元数据（浏览器与服务端共享；不要在这里 import 服务端代码）。
 */
import type { AdapterConsoleField } from 'zhin.js/adapter';

export const kookConsoleSpec = {
  adapterKey: 'kook',
  adapterDisplayName: 'KOOK',
  fields: [
    { key: 'token', required: true, env: true, description: 'KOOK bot token' },
    { key: 'encrypt_key', env: true, description: 'webhook 加密密钥（connection: webhook）', descriptionI18n: { en: 'Webhook encryption secret' } },
    { key: 'verify_token', env: true, description: 'webhook 验证 token（connection: webhook）', descriptionI18n: { en: 'Webhook verification token' } },
    { key: 'connection', description: 'websocket or webhook' },
    { key: 'webhookPath', description: 'Local webhook route' },
    { key: 'data_dir', description: 'SDK data directory' },
    { key: 'timeout', type: 'number', description: 'SDK request timeout' },
    { key: 'max_retry', type: 'number', description: 'SDK configured retry count' },
    { key: 'ignore', description: 'SDK inbound ignore setting: bot or self' },
    { key: 'logLevel', description: 'SDK log level' },
    { key: 'apiProxy.port', type: 'number', description: 'Configured API loopback proxy port' },
    { key: 'streamProxy.port', type: 'number', description: 'Configured Gateway loopback proxy port' },
    { key: 'streamProxy.serverName', description: 'Expected Gateway TLS hostname' },
  ] as readonly AdapterConsoleField[],
  docsUrl: 'https://zhin.js.org/adapters/kook',
  readPermission: 'kook:read',
  writePermission: 'kook:write',
} as const;
