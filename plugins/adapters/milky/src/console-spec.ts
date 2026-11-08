/**
 * Milky Console 页面元数据（浏览器与服务端共享；不要在这里 import 服务端代码）。
 */
import type { AdapterConsoleField } from 'zhin.js/adapter';

export const milkyConsoleSpec = {
  adapterKey: 'milky',
  adapterDisplayName: 'Milky',
  fields: [
    {
      key: 'baseUrl',
      required: true,
      label: 'Milky 服务地址',
      labelI18n: { en: 'Milky Base URL' },
      group: '连接模式',
      groupI18n: { en: 'Connection Mode' },
      placeholder: 'http://127.0.0.1:3000',
      description: 'Milky HTTP API base URL',
      descriptionI18n: { en: 'Milky HTTP API base URL' },
    },
    {
      key: 'path',
      label: '事件回调 / 反向 WS 路径',
      labelI18n: { en: 'Webhook / Reverse WS Path' },
      group: '连接模式',
      groupI18n: { en: 'Connection Mode' },
      placeholder: '/milky/event',
      description: 'webhook / reverse-wss 路径',
      descriptionI18n: { en: 'Webhook / reverse-wss path' },
    },
    {
      key: 'access_token',
      env: true,
      label: 'Access Token (访问令牌)',
      labelI18n: { en: 'Access Token' },
      group: '安全认证',
      groupI18n: { en: 'Authentication' },
      placeholder: 'Milky 服务端配置的 Access Token',
      placeholderI18n: { en: 'Access token configured on Milky server' },
      description: 'Milky 接口鉴权令牌（Access Token）',
      descriptionI18n: { en: 'Milky access token' },
    },
  ] as readonly AdapterConsoleField[],
  docsUrl: 'https://zhin.js.org/adapters/milky',
  readPermission: 'milky:read',
  writePermission: 'milky:write',
} as const;
