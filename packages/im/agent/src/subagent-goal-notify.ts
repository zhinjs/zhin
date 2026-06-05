/**
 * 主 Agent 委派子任务时，向 IM 用户即时发送进度提示。
 *
 * 注意：`kind` 是用户可见的「执行通道」（异步/视觉/定时/同步/编排），
 * 与 AgentDispatcher 内部的 `AgentRole`（subtask/worker 等工具权限）不是同一概念。
 */
import type { ToolContext } from '@zhin.js/core';

/** ToolContext.extra 中挂载的回调键 */
export const SUBAGENT_GOAL_NOTIFY_EXTRA_KEY = 'onSubagentGoal';

/** 用户可见的执行通道（进度提示中间段） */
export type SubagentExecutionKind = 'async' | 'sync' | 'vision' | 'draw' | 'deferred' | 'cron';

export const SUBAGENT_EXECUTION_KIND_LABELS: Record<SubagentExecutionKind, string> = {
  async: '异步',
  sync: '同步',
  vision: '视觉',
  draw: '文生图',
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

/** spawn / spawnSync 的执行通道：具名 agent 优先，否则 sync/async */
export function resolveSpawnExecutionKind(options: {
  sync?: boolean;
  agent?: string;
}): SubagentExecutionKind {
  const agent = options.agent?.trim().toLowerCase();
  if (agent === 'vision') return 'vision';
  if (agent === 'draw') return 'draw';
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

export function getSubagentGoalNotifier(ctx?: ToolContext): SubagentGoalNotifier | undefined {
  const fn = ctx?.extra?.[SUBAGENT_GOAL_NOTIFY_EXTRA_KEY];
  return typeof fn === 'function' ? (fn as SubagentGoalNotifier) : undefined;
}

export async function notifySubagentGoal(
  ctx: ToolContext | undefined,
  notice: SubagentProcessingNotice,
): Promise<void> {
  const notify = getSubagentGoalNotifier(ctx);
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
