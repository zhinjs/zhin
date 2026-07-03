import type { AgentTurnMessage, Message } from '@zhin.js/core';

/** AgentTurnMessage.extra 中挂载的回调键 */
export const SUBAGENT_GOAL_NOTIFY_EXTRA_KEY = 'onSubagentGoal';

/** 用户可见的执行通道（进度提示中间段） */
export type SubagentExecutionKind = 'async' | 'sync' | 'deferred' | 'cron';

export const SUBAGENT_EXECUTION_KIND_LABELS: Record<SubagentExecutionKind, string> = {
  async: '异步',
  sync: '同步',
  deferred: '编排',
  cron: '定时',
};

export interface SubagentProcessingNotice {
  taskId: string;
  kind: SubagentExecutionKind;
  label: string;
  /** ai.agents / spawn_task 的 agent 名（如 draw、vision） */
  agent?: string;
}

export type SubagentGoalNotifier = (notice: SubagentProcessingNotice) => void | Promise<void>;

export function resolveSubagentDisplayLabel(label: string | undefined, task: string): string {
  const trimmed = label?.trim();
  if (trimmed) return trimmed;
  return task.slice(0, 30) + (task.length > 30 ? '...' : '');
}

/** spawn / spawnSync 的执行通道 */
export function resolveSpawnExecutionKind(options: {
  sync?: boolean;
}): SubagentExecutionKind {
  if (options.sync) return 'sync';
  return 'async';
}

/** 日志与进度提示用的 agent 展示名 */
export function resolveSubagentAgentLabel(agent?: string): string | undefined {
  const a = agent?.trim();
  return a || undefined;
}

export function formatSubagentExecutionKindLabel(kind: SubagentExecutionKind): string {
  return SUBAGENT_EXECUTION_KIND_LABELS[kind] ?? kind;
}

/** 用户可见格式：任务【taskId】:执行通道·agent => label */
export function formatSubagentProcessingMessage(notice: SubagentProcessingNotice): string {
  const taskId = notice.taskId.trim();
  const kindLabel = formatSubagentExecutionKindLabel(notice.kind);
  const label = notice.label.trim() || '任务';
  const agent = resolveSubagentAgentLabel(notice.agent);
  const channel = agent ? `${kindLabel}·${agent}` : kindLabel;
  return `任务【${taskId}】:${channel} => ${label}`;
}

/**
 * 多 Bot 同群协作时，编排/子任务进度提示若发到群里会被 peer Bot 收进引用链。
 * 此类场景仅打日志，最终结论仍由主 Agent 正常 reply。
 */
export function shouldSuppressSubagentGoalNotifyToIm(
  message: Message,
  cell?: { members: { endpointId: string }[] },
): boolean {
  const scope = message.$channel?.type;
  if (scope !== 'group' && scope !== 'channel') return false;
  if (!cell?.members?.length) return false;
  const endpoints = new Set(cell.members.map((m) => m.endpointId));
  return endpoints.size >= 2;
}

export function getSubagentGoalNotifier(commMessage?: Message): SubagentGoalNotifier | undefined {
  const extra = commMessage ? (commMessage as AgentTurnMessage).extra : undefined;
  const fn = extra?.[SUBAGENT_GOAL_NOTIFY_EXTRA_KEY];
  return typeof fn === 'function' ? (fn as SubagentGoalNotifier) : undefined;
}

export async function notifySubagentGoal(
  commMessage: Message | undefined,
  notice: SubagentProcessingNotice,
): Promise<void> {
  const notify = getSubagentGoalNotifier(commMessage);
  if (!notify) return;
  if (!notice.taskId.trim() || !notice.label.trim()) return;
  try {
    await notify({
      taskId: notice.taskId.trim(),
      kind: notice.kind,
      label: notice.label.trim(),
    });
  } catch {
    // 进度提示失败不中断子任务
  }
}
