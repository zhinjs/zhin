/**
 * DingTalk Console 页面元数据（浏览器与服务端共享；不要在这里 import 服务端代码）。
 */
import type { AdapterConsoleField } from 'zhin.js/adapter';

export const dingtalkConsoleSpec = {
  adapterKey: 'dingtalk',
  adapterDisplayName: 'DingTalk',
  fields: [
    { key: 'appKey', required: true, env: true, description: '钉钉 AppKey', descriptionI18n: { en: 'DingTalk app key' } },
    { key: 'appSecret', required: true, env: true, description: '钉钉 AppSecret', descriptionI18n: { en: 'DingTalk app secret' } },
    { key: 'robotCode', required: true, env: true, description: '机器人 Code（出站 senderStaffId）', descriptionI18n: { en: 'Robot code (outbound senderStaffId)' } },
  ] as readonly AdapterConsoleField[],
  docsUrl: 'https://zhin.js.org/adapters/dingtalk',
  readPermission: 'dingtalk:read',
  writePermission: 'dingtalk:write',
} as const;
