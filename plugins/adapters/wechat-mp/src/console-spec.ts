/**
 * 微信公众号 Console 页面元数据（浏览器与服务端共享；不要在这里 import 服务端代码）。
 */
import type { AdapterConsoleField } from 'zhin.js/adapter';

export const wechatMpConsoleSpec = {
  adapterKey: 'wechat-mp',
  adapterDisplayName: '微信公众号',
  fields: [
    { key: 'appId', required: true, env: true, description: '公众号 AppID', descriptionI18n: { en: 'WeChat Official Account app ID' } },
    { key: 'appSecret', required: true, env: true, description: '公众号 AppSecret', descriptionI18n: { en: 'WeChat Official Account app secret' } },
    { key: 'token', required: true, env: true, description: '服务器配置 token', descriptionI18n: { en: 'Server configuration token' } },
    { key: 'encodingAESKey', env: true, description: '消息加解密 key', descriptionI18n: { en: 'Message encryption key' } },
  ] as readonly AdapterConsoleField[],
  docsUrl: 'https://zhin.js.org/adapters/wechat-mp',
  readPermission: 'wechat-mp:read',
  writePermission: 'wechat-mp:write',
} as const;
