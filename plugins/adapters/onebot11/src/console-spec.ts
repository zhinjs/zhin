/**
 * OneBot 11 Console 页面元数据（浏览器与服务端共享；不要在这里 import 服务端代码）。
 */
import type { AdapterConsoleField } from 'zhin.js/adapter';

export const onebot11ConsoleSpec = {
  adapterKey: 'onebot11',
  adapterDisplayName: 'OneBot 11',
  fields: [
    {
      key: 'url',
      label: '正向 WebSocket 地址',
      labelI18n: { en: 'Forward WebSocket URL' },
      group: '连接模式',
      groupI18n: { en: 'Connection Mode' },
      placeholder: 'ws://127.0.0.1:3001',
      description: 'OneBot 实现 WebSocket URL（connection: ws 必填）',
      descriptionI18n: { en: 'OneBot WebSocket URL (required for connection: ws)' },
    },
    {
      key: 'path',
      label: '反向 WebSocket 路径',
      labelI18n: { en: 'Reverse WebSocket Path' },
      group: '连接模式',
      groupI18n: { en: 'Connection Mode' },
      placeholder: '/onebot/v11/ws',
      description: 'reverse-wss 路径（connection: wss）',
      descriptionI18n: { en: 'Reverse WebSocket path (connection: wss)' },
    },
    {
      key: 'access_token',
      env: true,
      label: 'Access Token (访问令牌)',
      labelI18n: { en: 'Access Token' },
      group: '安全认证',
      groupI18n: { en: 'Authentication' },
      placeholder: '与 OneBot 协议端一致的 Token',
      placeholderI18n: { en: 'Token matching OneBot server config' },
      description: 'OneBot 11 接口鉴权令牌（Access Token）',
      descriptionI18n: { en: 'OneBot access token' },
    },
  ] as readonly AdapterConsoleField[],
  docsUrl: 'https://zhin.js.org/adapters/onebot11',
  readPermission: 'onebot11:read',
  writePermission: 'onebot11:write',
} as const;
