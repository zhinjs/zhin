/**
 * NapCat Console 页面元数据（浏览器与服务端共享；不要在这里 import 服务端代码）。
 */
import type { AdapterConsoleField } from 'zhin.js/adapter';

export const napcatConsoleSpec = {
  adapterKey: 'napcat',
  adapterDisplayName: 'NapCat',
  fields: [
    {
      key: 'url',
      label: '正向 WebSocket 地址',
      labelI18n: { en: 'Forward WebSocket URL' },
      group: '连接模式',
      groupI18n: { en: 'Connection Mode' },
      placeholder: 'ws://127.0.0.1:3001',
      description: 'NapCat WebSocket URL（connection: ws 必填）',
      descriptionI18n: { en: 'NapCat WebSocket URL (required for connection: ws)' },
    },
    {
      key: 'path',
      label: '反向 WebSocket 路径',
      labelI18n: { en: 'Reverse WebSocket Path' },
      group: '连接模式',
      groupI18n: { en: 'Connection Mode' },
      placeholder: '/napcat/ws',
      description: 'reverse-wss 路径（connection: wss）',
      descriptionI18n: { en: 'Reverse WebSocket path (connection: wss)' },
    },
    {
      key: 'http_url',
      label: 'HTTP API 地址',
      labelI18n: { en: 'HTTP API Base URL' },
      group: '连接模式',
      groupI18n: { en: 'Connection Mode' },
      placeholder: 'http://127.0.0.1:3000',
      description: 'HTTP API base URL（connection: http 出站）',
      descriptionI18n: { en: 'HTTP API base URL (outbound connection: http)' },
    },
    {
      key: 'post_path',
      label: 'HTTP 事件上报路径',
      labelI18n: { en: 'HTTP Event Post Path' },
      group: '连接模式',
      groupI18n: { en: 'Connection Mode' },
      placeholder: '/napcat/event',
      description: 'HTTP POST 事件路径（connection: http 入站）',
      descriptionI18n: { en: 'HTTP POST event path (inbound connection: http)' },
    },
    {
      key: 'access_token',
      env: true,
      label: 'Access Token (访问令牌)',
      labelI18n: { en: 'Access Token' },
      group: '安全认证',
      groupI18n: { en: 'Authentication' },
      placeholder: '与 NapCat 服务端一致的 Token',
      placeholderI18n: { en: 'Token matching NapCat server config' },
      description: 'NapCat 接口鉴权令牌（Access Token）',
      descriptionI18n: { en: 'NapCat access token' },
    },
  ] as readonly AdapterConsoleField[],
  docsUrl: 'https://zhin.js.org/adapters/napcat',
  readPermission: 'napcat:read',
  writePermission: 'napcat:write',
} as const;
