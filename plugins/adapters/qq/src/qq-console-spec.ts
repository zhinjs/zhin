/**
 * QQ Console 页面元数据（浏览器与服务端共享；不要在这里 import 服务端代码）。
 *
 * QQ 的 endpoint 不走通用「字段表单」：`qq endpoint add` 是扫码绑定流程，
 * 因此 `canAdd: false`，改由 `qq-console.ts` 的 `qq-bind-*` 动作完成。
 */
import type { AdapterConsoleField } from 'zhin.js/adapter';

export const qqConsoleSpec = {
  adapterKey: 'qq',
  adapterDisplayName: 'QQ',
  fields: [] as readonly AdapterConsoleField[],
  canAdd: false,
  canRemove: true,
  docsUrl: 'https://zhin.js.org/adapters/qq',
  readPermission: 'qq:read',
  writePermission: 'qq:write',
} as const;
