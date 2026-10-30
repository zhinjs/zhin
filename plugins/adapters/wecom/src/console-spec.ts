/**
 * 企业微信 Console 页面元数据（浏览器与服务端共享；不要在这里 import 服务端代码）。
 */
import type { AdapterConsoleField } from 'zhin.js/adapter';

export const wecomConsoleSpec = {
  adapterKey: 'wecom',
  adapterDisplayName: '企业微信',
  fields: [
    { key: 'corpId', required: true, env: true, description: '企业 corpId', descriptionI18n: { en: 'WeCom corporation ID' } },
    { key: 'agentSecret', required: true, env: true, description: '应用 secret', descriptionI18n: { en: 'Application secret' } },
    { key: 'token', required: true, env: true, description: '回调 token', descriptionI18n: { en: 'Callback token' } },
    { key: 'encodingAESKey', required: true, env: true, description: '回调加解密 key', descriptionI18n: { en: 'Callback encryption key' } },
  ] as readonly AdapterConsoleField[],
  docsUrl: 'https://zhin.js.org/adapters/wecom',
  readPermission: 'wecom:read',
  writePermission: 'wecom:write',
} as const;
