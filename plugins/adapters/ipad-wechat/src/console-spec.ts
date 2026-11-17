/**
 * 微信 iPad Console 页面元数据（浏览器与服务端共享；不要在这里 import 服务端代码）。
 */
import type { AdapterConsoleField } from 'zhin.js/adapter';

export const ipadWechatConsoleSpec = {
  adapterKey: 'ipad-wechat',
  adapterDisplayName: '微信 iPad',
  fields: [
    {
      key: 'dataDir',
      label: 'SDK 状态目录',
      labelI18n: { en: 'SDK state directory' },
      placeholder: 'data/ipad-wechat',
      description: '账号会话与签名状态的根目录；同一目录同时只能交给一个进程',
      descriptionI18n: { en: 'Root of the account session and signing state; one directory belongs to one process at a time' },
    },
  ] as readonly AdapterConsoleField[],
  docsUrl: 'https://zhin.js.org/adapters/ipad-wechat',
  readPermission: 'ipad-wechat:read',
  writePermission: 'ipad-wechat:write',
} as const;
