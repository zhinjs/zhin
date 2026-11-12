/**
 * Re-export permit 解析/校验 from @zhin.js/permission (SSOT)。
 * 保留 CommandSession 兼容签名供 command-index 过渡使用。
 */
import { checkBuiltinPermit, type PermissionSubject } from '@zhin.js/permission';

/**
 * 会话管理者：本会话层级链上的 zhin 聊天角色 `admin`（含 `owner`）。平台群主 / 管理员不自动具备
 * （ADR 0056 §4，2026-11-12 修订）：订阅等 zhin 功能需要被授予的角色。
 */
export const CONVERSATION_MANAGER_PERMIT = 'admin';

/**
 * 「私聊，或本会话 admin」。`permit` 列表只支持 AND，
 * 订阅类命令需要这个 OR 规则时用它，并以命令会话的 `scene` / `sender.chatRole` 为输入。
 */
export function canManageConversation(subject: PermissionSubject): boolean {
  return checkBuiltinPermit('private()', subject)
    || checkBuiltinPermit(CONVERSATION_MANAGER_PERMIT, subject);
}

export {
  type PermitKind,
  type ParsedPermit,
  parsePermitName,
  isBuiltinPermit,
  removedPermitReplacement,
  assertPermitSyntax as assertBuiltinPermits,
  checkBuiltinPermit,
  checkBuiltinPermitList,
} from '@zhin.js/permission';
