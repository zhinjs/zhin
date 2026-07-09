import type { Usage } from '@zhin.js/ai';
import { formatCompactLog, formatCompactUsage } from '@zhin.js/logger';

export type { HostTurnPath as ZhinAgentTurnPath, HostTurnMetrics as ZhinAgentTurnMetrics } from '../internal/host-types.js';
import type { HostTurnMetrics as ZhinAgentTurnMetrics } from '../internal/host-types.js';

export function addUsage(target: Usage, source?: Usage): void {
  if (!source) return;
  target.prompt_tokens += source.prompt_tokens;
  target.completion_tokens += source.completion_tokens;
  target.total_tokens += source.total_tokens;
}

export const EMPTY_USAGE: Usage = {
  prompt_tokens: 0,
  completion_tokens: 0,
  total_tokens: 0,
};

/** AI Handler 层统一汇总日志（紧凑 key-value） */
export function formatAiHandlerCompleteLog(metrics: ZhinAgentTurnMetrics, totalMs: number): string {
  return formatCompactLog('AI Handler', {
    total_ms: Math.round(totalMs),
    usage: formatCompactUsage(metrics.usage, metrics.subagentUsage),
    mode: metrics.path,
    iter: metrics.iterations,
    model: metrics.model,
  });
}

/** @deprecated 使用 formatCompactUsage from @zhin.js/logger */
export function formatZhinAgentTurnUsage(usage: Usage, subagentUsage?: Usage): string {
  return formatCompactUsage(usage, subagentUsage);
}
