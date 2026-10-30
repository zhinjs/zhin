/**
 * Email Console 页面元数据。SMTP/IMAP 是嵌套配置，页面只读展示连接与 endpoint，
 * 不提供字段表单（增删请改配置文件）。
 */
import type { AdapterConsoleField } from 'zhin.js/adapter';

export const emailConsoleSpec = {
  adapterKey: 'email',
  adapterDisplayName: 'Email',
  fields: [] as readonly AdapterConsoleField[],
  canAdd: false,
  canRemove: false,
  docsUrl: 'https://zhin.js.org/adapters/email',
  readPermission: 'email:read',
  writePermission: 'email:write',
} as const;
