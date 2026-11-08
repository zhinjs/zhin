/**
 * GitHub Console 页面元数据（浏览器与服务端共享；不要在这里 import 服务端代码）。
 */
import type { AdapterConsoleField } from 'zhin.js/adapter';

export const githubConsoleSpec = {
  adapterKey: 'github',
  adapterDisplayName: 'GitHub',
  fields: [
    {
      key: 'app_id',
      required: true,
      env: true,
      label: 'GitHub App ID',
      labelI18n: { en: 'GitHub App ID' },
      group: '应用凭证与私钥',
      groupI18n: { en: 'App Credentials & Key' },
      placeholder: '123456',
      description: 'GitHub App 设置页中的 App ID',
      descriptionI18n: { en: 'GitHub App ID' },
    },
    {
      key: 'private_key',
      required: true,
      secret: true,
      label: '私钥路径或 PEM 内容',
      labelI18n: { en: 'Private Key Path or PEM' },
      group: '应用凭证与私钥',
      groupI18n: { en: 'App Credentials & Key' },
      placeholder: './data/github-app.pem',
      description: 'PEM 文件路径（推荐，如 ./data/xxx.pem）或 PEM 内容',
      descriptionI18n: { en: 'PEM file path (recommended) or PEM content' },
    },
    {
      key: 'webhook_secret',
      env: true,
      label: 'Webhook Secret (签名密钥)',
      labelI18n: { en: 'Webhook Secret' },
      group: 'Webhook 回调',
      groupI18n: { en: 'Webhook Callback' },
      placeholder: '留空则仅作为 API-only 出站模式运行',
      placeholderI18n: { en: 'Optional webhook secret (API-only if omitted)' },
      description: 'webhook 签名密钥（不配则 API-only）',
      descriptionI18n: { en: 'Webhook signing secret (API-only when omitted)' },
    },
  ] as readonly AdapterConsoleField[],
  docsUrl: 'https://zhin.js.org/adapters/github',
  readPermission: 'github:read',
  writePermission: 'github:write',
} as const;
