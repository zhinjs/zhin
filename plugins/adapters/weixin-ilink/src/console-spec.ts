/**
 * 微信 iLink Console 页面元数据（浏览器与服务端共享；不要在这里 import 服务端代码）。
 */
import type { AdapterConsoleField } from 'zhin.js/adapter';

export const weixinIlinkConsoleSpec = {
  adapterKey: 'weixin-ilink',
  adapterDisplayName: '微信 iLink',
  fields: [
    { key: 'botToken', env: true, description: 'iLink bot token' },
  ] as readonly AdapterConsoleField[],
  docsUrl: 'https://zhin.js.org/adapters/weixin-ilink',
  readPermission: 'weixin-ilink:read',
  writePermission: 'weixin-ilink:write',
} as const;
