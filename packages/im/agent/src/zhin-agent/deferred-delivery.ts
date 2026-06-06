import { truncatePreview } from '@zhin.js/logger';
import type { DeferredWorkerResult } from '../deferred-worker-runner.js';
import { originFromToolContext } from '../builtin/spawn-task-tool.js';
import type { ToolContext } from '../orchestrator/types.js';
import { buildSubagentUserDelivery } from '../media/subagent-user-delivery.js';
import type { SubagentResultSender } from '../subagent.js';
import { resolveSubagentDisplayLabel } from '../subagent-goal-notify.js';

function extractDeferredBody(result: DeferredWorkerResult): string {
  try {
    const parsed = JSON.parse(result.summary) as {
      summary?: string;
      error?: string;
      status?: string;
    };
    if (parsed.error?.trim()) return parsed.error.trim();
    if (parsed.summary?.trim()) return parsed.summary.trim();
  } catch {
    // fall through
  }
  return result.summary.trim();
}

export async function deliverDeferredWorkerResult(
  sender: SubagentResultSender,
  context: ToolContext,
  goal: string,
  taskId: string,
  result: DeferredWorkerResult,
): Promise<void> {
  const label = resolveSubagentDisplayLabel(undefined, goal);
  const body = extractDeferredBody(result) || truncatePreview(goal, 300);
  const delivery = buildSubagentUserDelivery({
    label: `deferred:${taskId} ${label}`,
    status: result.status === 'error' ? 'error' : 'ok',
    result: body,
    toolCalls: result.toolCalls ?? [],
  });
  await sender(originFromToolContext(context), delivery);
}
