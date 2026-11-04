/**
 * 受控自我进化：谁能起草（#1051 F4，Q3=B）。
 *
 * 只有**主人**（本条消息的发送者带框架角色 `master`：`endpoints.<id>.master` / `trigger.masters`）
 * 与 **IM 审批人**（`ai.agent.toolHardGate.imApproval` 开启时，`approverIds` 里该平台的人）可以起草；
 * 群成员、私聊陌生人、`trusted` 都不行。审批人范围本身不变（审批仍由主人私聊 / 审批人 / Console 结算）。
 *
 * 纯函数，不碰磁盘；`change_draft` 用它在工具面隐藏（模型看不到就不会尝试），执行时再兜底拒绝并审计
 * `change_draft_forbidden`。
 */
import { isImApprover, type ToolHardGateImApprovalSettings } from '../security/tool-hard-gate.js';

/** 框架给主人打的角色（见 CLI 的 sender roles 解析）。 */
export const SELF_CHANGE_MASTER_ROLE = 'master';

export interface SelfChangeDrafter {
  readonly platform: string;
  /** 已认证的发送者 id。 */
  readonly subjectId: string;
  /** 框架角色（`master` / `trusted` / `user`）与平台角色。 */
  readonly roles: readonly string[];
}

/** 起草人判定：主人，或 IM 审批通道开启时该平台的审批人。 */
export function canDraftSelfChange(
  drafter: SelfChangeDrafter,
  imApproval?: ToolHardGateImApprovalSettings | null,
): boolean {
  const subjectId = drafter.subjectId.trim();
  if (!subjectId) return false;
  if (drafter.roles.includes(SELF_CHANGE_MASTER_ROLE)) return true;
  return imApproval ? isImApprover(imApproval, drafter.platform, subjectId) : false;
}

export class SelfChangeDraftForbiddenError extends Error {
  constructor() {
    super('only the bot owner or an approver may draft a change to the bot itself');
    this.name = 'SelfChangeDraftForbiddenError';
  }
}
