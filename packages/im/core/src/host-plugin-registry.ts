/**
 * @deprecated **已删除**。服务通过 Scope+Token 提供；不再有全局根插件引用。
 */
import type { Plugin } from './plugin.js';

/** @deprecated 已删除——不做任何事。 */
export function setHostRootPlugin(_plugin: Plugin | null): void {
  // no-op: legacy host root plugin registry has been removed
}

/** @deprecated 已删除——总是返回 null。 */
export function getHostRootPlugin(): Plugin | null {
  return null;
}
