/**
 * Re-export permit 解析/校验 from @zhin.js/permission (SSOT)。
 * 保留 CommandSession 兼容签名供 command-index 过渡使用。
 */
import { checkBuiltinPermit, type PermissionSubject } from '@zhin.js/permission';

/** 会话管理者：群主 / 群管理员 / 机器人主人（适配器投影的规范角色名）。 */
export const CONVERSATION_MANAGER_PERMIT = 'role(owner,admin,master)';

/**
 * 「私聊，或 owner / admin / master」。`permit` 列表只支持 AND，
 * 订阅类命令需要这个 OR 规则时用它，并以命令会话的 `scene` / `sender.role` 为输入。
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
  isPlatformPermit,
  assertPermitSyntax as assertBuiltinPermits,
  checkBuiltinPermit,
  checkBuiltinPermitList,
} from '@zhin.js/permission';
