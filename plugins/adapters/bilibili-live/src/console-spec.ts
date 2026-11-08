/**
 * Bilibili Live Console 页面元数据（浏览器与服务端共享；不要在这里 import 服务端代码）。
 */
import type { AdapterConsoleField } from 'zhin.js/adapter';

export const bilibiliLiveConsoleSpec = {
  adapterKey: 'bilibili-live',
  adapterDisplayName: 'Bilibili 直播弹幕',
  fields: [
    {
      key: 'roomId',
      required: true,
      label: '直播间房号 (Room ID)',
      labelI18n: { en: 'Live Room ID' },
      group: '直播间配置',
      groupI18n: { en: 'Live Room' },
      placeholder: '例如 21452505',
      description: '直播间号（短号或长号）',
      descriptionI18n: { en: 'Live room ID (short or long)' },
    },
    {
      key: 'sessdata',
      env: true,
      secret: true,
      label: 'Cookie SESSDATA',
      labelI18n: { en: 'Cookie SESSDATA' },
      group: '登录与弹幕发送凭据',
      groupI18n: { en: 'Auth & Danmaku Credentials' },
      placeholder: '浏览器 Cookie 中的 SESSDATA（发弹幕必填）',
      placeholderI18n: { en: 'SESSDATA cookie value (required for sending danmaku)' },
      description: 'Cookie SESSDATA（发弹幕需要，建议用环境变量）',
      descriptionI18n: { en: 'Cookie SESSDATA (needed to send danmaku; prefer env vars)' },
    },
    {
      key: 'biliJct',
      env: true,
      secret: true,
      label: 'Cookie bili_jct (CSRF Token)',
      labelI18n: { en: 'Cookie bili_jct' },
      group: '登录与弹幕发送凭据',
      groupI18n: { en: 'Auth & Danmaku Credentials' },
      placeholder: '浏览器 Cookie 中的 bili_jct（发弹幕必填）',
      placeholderI18n: { en: 'bili_jct cookie value (required for sending danmaku)' },
      description: 'Cookie bili_jct（发弹幕需要）',
      descriptionI18n: { en: 'Cookie bili_jct (needed to send danmaku)' },
    },
    {
      key: 'buvid3',
      env: true,
      secret: true,
      label: 'Cookie buvid3 (设备标识)',
      labelI18n: { en: 'Cookie buvid3' },
      group: '登录与弹幕发送凭据',
      groupI18n: { en: 'Auth & Danmaku Credentials' },
      placeholder: '可留空，启动时自动申请匿名 buvid3',
      placeholderI18n: { en: 'Optional; automatically fetched at startup if empty' },
      description: 'Cookie buvid3（可留空，启动时自动申请）',
      descriptionI18n: { en: 'Cookie buvid3 (optional; fetched at startup when empty)' },
    },
  ] as readonly AdapterConsoleField[],
  docsUrl: 'https://zhin.js.org/adapters/bilibili-live',
  readPermission: 'bilibili-live:read',
  writePermission: 'bilibili-live:write',
} as const;
