/**
 * Email Console 页面元数据。SMTP/IMAP 字段经闭合声明路径编写；账号变更由所属 Adapter 持久化。
 */
import type { AdapterConsoleField } from 'zhin.js/adapter';

export const emailConsoleSpec = {
  adapterKey: 'email',
  adapterDisplayName: 'Email',
  fields: [
    { key: 'smtp.host', type: 'string', required: true },
    { key: 'smtp.port', type: 'number', required: true },
    { key: 'smtp.secure', type: 'boolean', required: true },
    { key: 'smtp.serverName', type: 'string' },
    { key: 'smtp.auth.user', type: 'string', required: true },
    { key: 'smtp.auth.pass', type: 'string', required: true, secret: true },
    { key: 'imap.host', type: 'string', required: true },
    { key: 'imap.port', type: 'number', required: true },
    { key: 'imap.tls', type: 'boolean', required: true },
    { key: 'imap.serverName', type: 'string' },
    { key: 'imap.user', type: 'string', required: true },
    { key: 'imap.password', type: 'string', required: true, secret: true },
    { key: 'imap.mailbox', type: 'string' },
    { key: 'imap.checkInterval', type: 'number' },
    { key: 'imap.reconnectInterval', type: 'number' },
    { key: 'imap.markSeen', type: 'boolean' },
    { key: 'attachments.enabled', type: 'boolean' },
    { key: 'attachments.downloadPath', type: 'string' },
    { key: 'attachments.maxFileSize', type: 'number' },
  ] as readonly AdapterConsoleField[],
  docsUrl: 'https://zhin.js.org/adapters/email',
  readPermission: 'email:read',
  writePermission: 'email:write',
} as const;
