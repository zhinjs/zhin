/**
 * #1250: static check (config file only, no IM layers) for approval settings that cannot be answered.
 * Unattended turns (scheduled tasks, reminders, background events, MCP / A2A calls) have no approval
 * channel; in IM only the bot owner, or a zhin `admin` confirming their own live turn, can approve.
 */
export interface ApprovalConfigDiagnosis {
  readonly status: 'ok' | 'warn';
  readonly message: string;
  readonly fix?: string;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export function diagnoseApprovalChannelConfig(config: Record<string, unknown> | null | undefined): ApprovalConfigDiagnosis | undefined {
  const ai = record(config?.ai);
  if (!ai || ai.enabled === false) return undefined;
  const agent = record(ai.agent);
  const mode = agent?.execApprovalMode ?? 'auto';
  const confirmHighRisk = record(agent?.injectionGuard)?.confirmHighRisk ?? 'external_content';
  if (mode === 'ask') {
    return {
      status: 'warn',
      message: 'ai.agent.execApprovalMode 为 ask：定时任务等无人值守回合没有审批渠道，需要审批的工具会被直接拒绝；'
        + 'IM 里只有 Bot 主人或 zhin 管理员（admin，本人发起的实时回合）能确认，其他用户需要审批的操作会被拒绝',
      fix: '需要无人值守执行时改为 execApprovalMode: auto（审核 Agent 判断），或在 Console 中操作',
    };
  }
  return {
    status: 'ok',
    message: confirmHighRisk === 'off'
      ? `execApprovalMode: ${String(mode)}，未开启读取外部内容后的高危动作确认`
      : `execApprovalMode: ${String(mode)}；读取外部内容后的高危动作在实时 IM 会话中请发起人确认，定时任务等无人值守回合中会被拒绝`,
  };
}
