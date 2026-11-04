/**
 * Bilibili Live Console 页面元数据（浏览器与服务端共享；不要在这里 import 服务端代码）。
 */
import type { AdapterConsoleField } from 'zhin.js/adapter';

export const bilibiliLiveConsoleSpec = {
  adapterKey: 'bilibili-live',
  adapterDisplayName: 'Bilibili 直播弹幕',
  fields: [
    { key: 'roomId', required: true, description: '直播间号（短号或长号）', descriptionI18n: { en: 'Live room ID (short or long)' } },
    { key: 'sessdata', env: true, secret: true, description: 'Cookie SESSDATA（发弹幕需要，建议用环境变量）', descriptionI18n: { en: 'Cookie SESSDATA (needed to send danmaku; prefer env vars)' } },
    { key: 'biliJct', env: true, secret: true, description: 'Cookie bili_jct（发弹幕需要）', descriptionI18n: { en: 'Cookie bili_jct (needed to send danmaku)' } },
    { key: 'buvid3', env: true, secret: true, description: 'Cookie buvid3（可留空，启动时自动申请）', descriptionI18n: { en: 'Cookie buvid3 (optional; fetched at startup when empty)' } },
  ] as readonly AdapterConsoleField[],
  docsUrl: 'https://zhin.js.org/adapters/bilibili-live',
  readPermission: 'bilibili-live:read',
  writePermission: 'bilibili-live:write',
} as const;
