/**
 * IM 运维 / 内省斜杠命令：仅 master 或 trusted 可执行（与 docs/essentials/commands.md 一致）。
 * @deprecated 从 @zhin.js/core 导入
 */
export {
  MANAGEMENT_COMMAND_DENIED,
  MANAGEMENT_OPERATOR_PERMIT,
  rejectUnlessManagementOperator,
  resolveManagementCommandRoles,
} from '@zhin.js/core';
