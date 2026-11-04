/**
 * GitHub Console 页面元数据（浏览器与服务端共享；不要在这里 import 服务端代码）。
 */
import type { AdapterConsoleField } from 'zhin.js/adapter';

export const githubConsoleSpec = {
  adapterKey: 'github',
  adapterDisplayName: 'GitHub',
  fields: [
    { key: 'app_id', required: true, env: true, description: 'GitHub App ID' },
    { key: 'private_key', required: true, secret: true, description: 'PEM 文件路径（推荐，如 ./data/xxx.pem）或 PEM 内容', descriptionI18n: { en: 'PEM file path (recommended) or PEM content' } },
    { key: 'webhook_secret', env: true, description: 'webhook 签名密钥（不配则 API-only）', descriptionI18n: { en: 'Webhook signing secret (API-only when omitted)' } },
  ] as readonly AdapterConsoleField[],
  docsUrl: 'https://zhin.js.org/adapters/github',
  readPermission: 'github:read',
  writePermission: 'github:write',
} as const;
