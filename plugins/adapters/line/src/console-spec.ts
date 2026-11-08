/**
 * LINE Console 页面元数据（浏览器与服务端共享；不要在这里 import 服务端代码）。
 */
import type { AdapterConsoleField } from 'zhin.js/adapter';

export const lineConsoleSpec = {
  adapterKey: 'line',
  adapterDisplayName: 'LINE',
  fields: [
    {
      key: 'channelSecret',
      required: true,
      env: true,
      label: 'Channel Secret (频道密钥)',
      labelI18n: { en: 'Channel Secret' },
      group: '基础认证',
      groupI18n: { en: 'Basic Auth' },
      placeholder: '32 位十六进制 Channel Secret',
      placeholderI18n: { en: 'LINE Messaging API Channel Secret' },
      description: 'LINE Developers 控制台生成的 Channel Secret',
      descriptionI18n: { en: 'LINE channel secret' },
    },
    {
      key: 'channelAccessToken',
      required: true,
      env: true,
      label: 'Channel Access Token (访问令牌)',
      labelI18n: { en: 'Channel Access Token' },
      group: '基础认证',
      groupI18n: { en: 'Basic Auth' },
      placeholder: '长效 Channel Access Token',
      placeholderI18n: { en: 'Long-lived Channel Access Token' },
      description: 'LINE Messaging API 的长效 Channel Access Token',
      descriptionI18n: { en: 'LINE channel access token' },
    },
  ] as readonly AdapterConsoleField[],
  docsUrl: 'https://zhin.js.org/adapters/line',
  readPermission: 'line:read',
  writePermission: 'line:write',
} as const;
