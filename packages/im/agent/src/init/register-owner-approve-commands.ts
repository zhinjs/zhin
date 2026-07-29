/**
 * Owner 私聊 `/approve` —— **legacy MessageCommand 路径已移除**。
 *
 * Plugin Runtime 命令面：`handleRuntimeOwnerApproveCommand`
 *（`basic/cli` Agent Host 在入站拦截）。勿再 `new MessageCommand('/approve…')`。
 *
 * @deprecated 保留空壳以免旧调用方炸；下一个 minor 可删除本文件与 `initAgentModule` 引用。
 */
export function registerOwnerApproveCommands(): void {
  // no-op：Runtime 路径由 handleRuntimeOwnerApproveCommand 承接
}
