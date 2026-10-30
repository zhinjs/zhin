/**
 * Slack Console 页面元数据（浏览器与服务端共享；不要在这里 import 服务端代码）。
 */
import type { AdapterConsoleField } from 'zhin.js/adapter';

export const slackConsoleSpec = {
  adapterKey: 'slack',
  adapterDisplayName: 'Slack',
  fields: [
    { key: 'token', required: true, env: true, description: 'Bot User OAuth Token（xoxb-...）' },
    { key: 'signingSecret', env: true, description: '签名密钥（HTTP Events，socketMode: false 必填）', descriptionI18n: { en: 'Signing secret (required for HTTP Events)' } },
    { key: 'appToken', env: true, description: 'App-Level Token（xapp-...，Socket Mode）', descriptionI18n: { en: 'App-level token (xapp-..., Socket Mode)' } },
  ] as readonly AdapterConsoleField[],
  docsUrl: 'https://zhin.js.org/adapters/slack',
  readPermission: 'slack:read',
  writePermission: 'slack:write',
} as const;
