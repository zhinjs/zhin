/**
 * DingTalk Console 页面元数据（浏览器与服务端共享；不要在这里 import 服务端代码）。
 */
import type { AdapterConsoleField } from 'zhin.js/adapter';

export const dingtalkConsoleSpec = {
  adapterKey: 'dingtalk',
  adapterDisplayName: '钉钉 / DingTalk',
  fields: [
    {
      key: 'appKey',
      required: true,
      env: true,
      label: 'AppKey / Client ID',
      labelI18n: { en: 'AppKey / Client ID' },
      group: '企业应用凭证',
      groupI18n: { en: 'Enterprise App Credentials' },
      placeholder: 'dingxxxxxxxxxxxx',
      description: '钉钉开放平台应用的 AppKey（或 Client ID）',
      descriptionI18n: { en: 'DingTalk app key' },
    },
    {
      key: 'appSecret',
      required: true,
      env: true,
      label: 'AppSecret / Client Secret',
      labelI18n: { en: 'AppSecret / Client Secret' },
      group: '企业应用凭证',
      groupI18n: { en: 'Enterprise App Credentials' },
      placeholder: '钉钉开放平台生成的 AppSecret',
      placeholderI18n: { en: 'AppSecret from DingTalk Developer Console' },
      description: '钉钉开放平台应用的 AppSecret（或 Client Secret）',
      descriptionI18n: { en: 'DingTalk app secret' },
    },
    {
      key: 'robotCode',
      env: true,
      label: 'RobotCode (机器人编码)',
      labelI18n: { en: 'Robot Code' },
      group: '企业应用凭证',
      groupI18n: { en: 'Enterprise App Credentials' },
      placeholder: 'dingxxxxxxxxxxxx（主动发消息必填）',
      placeholderI18n: { en: 'dingxxxxxxxxxxxx (for proactive outbound)' },
      description: '机器人 Code（出站单聊/群聊主动消息所需）',
      descriptionI18n: { en: 'Robot code (outbound senderStaffId)' },
    },
  ] as readonly AdapterConsoleField[],
  docsUrl: 'https://zhin.js.org/adapters/dingtalk',
  readPermission: 'dingtalk:read',
  writePermission: 'dingtalk:write',
} as const;
