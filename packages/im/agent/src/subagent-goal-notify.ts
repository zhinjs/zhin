/**
 * 主 Agent 委派子任务时，向 IM 用户即时发送 goal 进度提示。
 */
import type { ToolContext } from '@zhin.js/core';

/** ToolContext.extra 中挂载的回调键 */
export const SUBAGENT_GOAL_NOTIFY_EXTRA_KEY = 'onSubagentGoal';

export type SubagentGoalNotifier = (goal: string) => void | Promise<void>;

const MAX_GOAL_CHARS = 500;

export function truncateSubagentGoal(goal: string): string {
  const trimmed = goal.trim();
  if (trimmed.length <= MAX_GOAL_CHARS) return trimmed;
  return `${trimmed.slice(0, MAX_GOAL_CHARS)}…`;
}

/** 用户可见格式：🔧 正在执行：${goal} */
export function formatSubagentProcessingMessage(goal: string): string {
  return `🔧 正在执行：${truncateSubagentGoal(goal)}`;
}

export function getSubagentGoalNotifier(ctx?: ToolContext): SubagentGoalNotifier | undefined {
  const fn = ctx?.extra?.[SUBAGENT_GOAL_NOTIFY_EXTRA_KEY];
  return typeof fn === 'function' ? (fn as SubagentGoalNotifier) : undefined;
}

export async function notifySubagentGoal(ctx: ToolContext | undefined, goal: string): Promise<void> {
  const notify = getSubagentGoalNotifier(ctx);
  if (!notify) return;
  const trimmed = goal.trim();
  if (!trimmed) return;
  try {
    await notify(trimmed);
  } catch {
    // 进度提示失败不中断子任务
  }
}
