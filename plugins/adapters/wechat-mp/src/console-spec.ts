/**
 * 微信公众号 Console 页面元数据（浏览器与服务端共享；不要在这里 import 服务端代码）。
 */
import type { AdapterConsoleField } from 'zhin.js/adapter';

export const wechatMpConsoleSpec = {
  adapterKey: 'wechat-mp',
  adapterDisplayName: '微信公众号',
  fields: [
    {
      key: 'appId',
      required: true,
      env: true,
      label: '公众号 AppID',
      labelI18n: { en: 'Official Account AppID' },
      group: '企业应用凭证',
      groupI18n: { en: 'Enterprise App Credentials' },
      placeholder: 'wx1234567890abcdef',
      description: '微信公众平台「基本配置」中的开发者 ID (AppID)',
      descriptionI18n: { en: 'WeChat Official Account app ID' },
    },
    {
      key: 'appSecret',
      required: true,
      env: true,
      label: '公众号 AppSecret',
      labelI18n: { en: 'Official Account AppSecret' },
      group: '企业应用凭证',
      groupI18n: { en: 'Enterprise App Credentials' },
      placeholder: '开发者密码 AppSecret',
      placeholderI18n: { en: 'Developer password AppSecret' },
      description: '微信公众平台「基本配置」中的开发者密码 (AppSecret)',
      descriptionI18n: { en: 'WeChat Official Account app secret' },
    },
    {
      key: 'token',
      required: true,
      env: true,
      label: '服务器配置 Token',
      labelI18n: { en: 'Server Token' },
      group: '事件回调与加解密',
      groupI18n: { en: 'Event Callback & Encryption' },
      placeholder: '服务器配置的验证令牌 Token',
      placeholderI18n: { en: 'Server configuration verification token' },
      description: '微信公众平台「服务器配置」中的令牌 (Token)',
      descriptionI18n: { en: 'Server configuration token' },
    },
    {
      key: 'encodingAESKey',
      env: true,
      label: 'EncodingAESKey (消息加解密密钥)',
      labelI18n: { en: 'EncodingAESKey' },
      group: '事件回调与加解密',
      groupI18n: { en: 'Event Callback & Encryption' },
      placeholder: '43 位字符（安全模式必填，明文模式可留空）',
      placeholderI18n: { en: '43-char key (required for encrypted mode)' },
      description: '消息加解密密钥（EncodingAESKey）',
      descriptionI18n: { en: 'Message encryption key' },
    },
  ] as readonly AdapterConsoleField[],
  docsUrl: 'https://zhin.js.org/adapters/wechat-mp',
  readPermission: 'wechat-mp:read',
  writePermission: 'wechat-mp:write',
} as const;
