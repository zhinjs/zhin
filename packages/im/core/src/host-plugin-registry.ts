/**
 * @deprecated **已删除**。全局根插件注册表已移除；服务通过 Scope+Token 提供。
 * 保留 no-op 签名供编译期过渡。
 */

/** @deprecated 已删除——不做任何事。 */
export function setHostRootPlugin(_plugin: unknown): void {
  // no-op: legacy host root plugin registry has been removed
}

/** @deprecated 已删除——总是返回 null。 */
export function getHostRootPlugin(): null {
  return null;
}
