/**
 * 微信 iLink Console 页面元数据（浏览器与服务端共享；不要在这里 import 服务端代码）。
 */
import type { AdapterConsoleField } from 'zhin.js/adapter';

export const weixinIlinkConsoleSpec = {
  adapterKey: 'weixin-ilink',
  adapterDisplayName: '微信 iLink',
  fields: [
    {
      key: 'botToken',
      env: true,
      label: 'iLink Bot Token',
      labelI18n: { en: 'iLink Bot Token' },
      group: '企业应用凭证',
      groupI18n: { en: 'Enterprise App Credentials' },
      placeholder: '扫码授权获取的 iLink Bot Token',
      placeholderI18n: { en: 'iLink bot token obtained via QR auth' },
      description: '微信 iLink 机器人凭证（也可通过命令扫码自动写入）',
      descriptionI18n: { en: 'iLink bot token' },
    },
  ] as readonly AdapterConsoleField[],
  docsUrl: 'https://zhin.js.org/adapters/weixin-ilink',
  readPermission: 'weixin-ilink:read',
  writePermission: 'weixin-ilink:write',
} as const;
