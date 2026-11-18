/**
 * #1250: configuration that asks for approvals where nobody can give one. Unattended turns (scheduled
 * tasks, assistant reminders, background events, MCP / A2A calls) never have an approval channel, and an
 * IM private chat can only be answered by the bot owner or a zhin `admin` initiator. Reported once at
 * startup so `ask` / `confirmHighRisk` do not fail silently.
 */
import { HIGH_RISK_ACTION_KINDS, resolveHighRiskConfirm, type ConfirmHighRiskSetting, type HighRiskActionKind } from './provenance.js';

const CATEGORY_LABELS: Readonly<Record<HighRiskActionKind, string>> = Object.freeze({
  shell: '执行命令',
  file_write: '写文件',
  outbound: '向其他会话发消息',
  config: '修改配置',
  schedule: '定时任务',
});
export interface ApprovalChannelConflictInput {
  /** `ai.agent.execApprovalMode` (default `auto`). */
  readonly execApprovalMode?: 'ask' | 'auto' | 'bypass';
  /** `ai.agent.injectionGuard.confirmHighRisk` (unset: the ADR 0067 per-category defaults). */
  readonly confirmHighRisk?: ConfirmHighRiskSetting;
  /** Enabled sources of unattended Agent turns that can call tools, as user-facing labels. */
  readonly unattendedChannels: readonly string[];
}

export function describeApprovalChannelConflicts(input: ApprovalChannelConflictInput): string[] {
  const conflicts: string[] = [];
  const unattended = input.unattendedChannels.length > 0 ? input.unattendedChannels.join('、') : undefined;
  if (input.execApprovalMode === 'ask') {
    conflicts.push(
      'ai.agent.execApprovalMode 为 ask：无人值守的回合'
      + `（${unattended ? `${unattended}、` : ''}后台事件、MCP / A2A 调用等）没有审批渠道，需要审批的工具在这些回合会被直接拒绝；`
      + 'IM 里只有 Bot 主人，或在私聊 / 发起人在场的群聊中的 zhin 管理员（admin）本人能确认，其他用户需要审批的操作会被拒绝。'
      + '如需无人值守执行，改用 auto（由审核 Agent 判断），或在 Console 中操作。',
    );
  }
  const policy = resolveHighRiskConfirm(input.confirmHighRisk);
  const confirmed = HIGH_RISK_ACTION_KINDS.filter(kind => policy[kind] !== 'off');
  if (confirmed.length > 0 && unattended) {
    conflicts.push(
      'ai.agent.injectionGuard.confirmHighRisk 未关闭：'
      + `${unattended}触发的回合是无人值守的，没有审批渠道；这些回合读取外部内容后的高危动作`
      + `（${confirmed.map(kind => CATEGORY_LABELS[kind]).join('、')}）会被拒绝。`
      + '实时 IM 会话中会在当前会话请发起人确认。',
    );
  }
  return conflicts;
}
