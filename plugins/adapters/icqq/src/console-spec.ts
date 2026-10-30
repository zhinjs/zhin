/**
 * ICQQ Console 页面元数据（浏览器与服务端共享；不要在这里 import 服务端代码）。
 */
import type { AdapterConsoleField } from 'zhin.js/adapter';

export const icqqConsoleSpec = {
  adapterKey: 'icqq',
  adapterDisplayName: 'ICQQ',
  fields: [
  ] as readonly AdapterConsoleField[],
  docsUrl: 'https://zhin.js.org/adapters/icqq',
  readPermission: 'icqq:read',
  writePermission: 'icqq:write',
  idPattern: /^\d+$/,
  idHint: 'ICQQ endpoint id 是 QQ 号（纯数字）',
  idHintI18n: { en: 'ICQQ endpoint ID is the QQ number (digits only)' },
} as const;
