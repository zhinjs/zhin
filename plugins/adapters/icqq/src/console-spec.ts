/**
 * ICQQ Console 页面元数据（浏览器与服务端共享；不要在这里 import 服务端代码）。
 */
import type { AdapterConsoleField } from 'zhin.js/adapter';

export const icqqConsoleSpec = {
  adapterKey: 'icqq',
  adapterDisplayName: 'ICQQ',
  fields: [
    { key: 'password', env: true, description: 'QQ password; leave blank to retain the saved credential' },
    { key: 'platform', type: 'number', description: 'ICQQ platform number' },
    { key: 'ver', description: 'ICQQ protocol version' },
    { key: 'dataDir', description: 'ICQQ device and session directory' },
    { key: 'signApiAddr', description: 'ICQQ signing service URL' },
    { key: 'autoReconnect', type: 'boolean', description: 'ICQQ reconnect setting' },
    { key: 'autoServer', type: 'boolean', description: 'ICQQ automatic server selection' },
    { key: 'qqnt', type: 'boolean', description: 'QQNT protocol' },
    { key: 'ntLogin', type: 'boolean', description: 'QQNT login' },
  ] as readonly AdapterConsoleField[],
  docsUrl: 'https://zhin.js.org/adapters/icqq',
  readPermission: 'icqq:read',
  writePermission: 'icqq:write',
  idPattern: /^\d+$/,
  idHint: 'ICQQ endpoint id 是 QQ 号（纯数字）',
  idHintI18n: { en: 'ICQQ endpoint ID is the QQ number (digits only)' },
} as const;
