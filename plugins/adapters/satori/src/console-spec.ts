/**
 * Satori Console 页面元数据（浏览器与服务端共享；不要在这里 import 服务端代码）。
 */
import type { AdapterConsoleField } from 'zhin.js/adapter';

export const satoriConsoleSpec = {
  adapterKey: 'satori',
  adapterDisplayName: 'Satori',
  fields: [
    {
      key: 'platform',
      required: true,
      label: '登录平台 (Platform)',
      labelI18n: { en: 'Platform' },
      group: '连接模式',
      groupI18n: { en: 'Connection Mode' },
      placeholder: 'chronocat / qq / onebot',
      description: 'Satori 登录所属平台标识',
      descriptionI18n: { en: 'Selected Satori login platform' },
    },
    {
      key: 'userId',
      required: true,
      label: '机器人账号 ID (User ID)',
      labelI18n: { en: 'Bot User ID' },
      group: '连接模式',
      groupI18n: { en: 'Connection Mode' },
      placeholder: '123456789',
      description: 'Satori 登录对应的机器人用户 ID',
      descriptionI18n: { en: 'Selected Satori login user ID' },
    },
    {
      key: 'baseUrl',
      required: true,
      label: 'Satori 服务地址',
      labelI18n: { en: 'Satori Base URL' },
      group: '连接模式',
      groupI18n: { en: 'Connection Mode' },
      placeholder: 'http://127.0.0.1:5500/v1',
      description: 'Satori 服务 base URL',
      descriptionI18n: { en: 'Satori service base URL' },
    },
    {
      key: 'path',
      label: 'Webhook 回调路径',
      labelI18n: { en: 'Webhook Path' },
      group: '连接模式',
      groupI18n: { en: 'Connection Mode' },
      placeholder: '/satori/webhook',
      description: 'webhook 路径（connection: webhook）',
      descriptionI18n: { en: 'Webhook path (connection: webhook)' },
    },
    {
      key: 'token',
      env: true,
      label: 'Satori Token (鉴权令牌)',
      labelI18n: { en: 'Satori Token' },
      group: '安全认证',
      groupI18n: { en: 'Authentication' },
      placeholder: 'Satori 服务端配置的 Token',
      placeholderI18n: { en: 'Token configured on Satori server' },
      description: 'Satori 接口鉴权令牌',
      descriptionI18n: { en: 'Satori access token' },
    },
  ] as readonly AdapterConsoleField[],
  docsUrl: 'https://zhin.js.org/adapters/satori',
  readPermission: 'satori:read',
  writePermission: 'satori:write',
} as const;
