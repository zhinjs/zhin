import type { OutputElement } from '@zhin.js/ai';
import { truncatePreview } from '@zhin.js/logger';
import type { DeferredWorkerResult } from '../deferred-worker-runner.js';
import { originFromMessage } from '../builtin/spawn-task-tool.js';
import type { Message } from '../orchestrator/types.js';
import { buildSubagentUserDelivery } from '../media/subagent-user-delivery.js';
import type { SubagentResultSender } from '../subagent/index.js';
import { resolveSubagentDisplayLabel } from '../subagent-goal-notify.js';

export function extractDeferredBody(result: DeferredWorkerResult): string {
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
  commMessage: Message,
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
  await sender(originFromMessage(commMessage), delivery);
}

/** deferred auto-continue 完成后将主 Agent 续聊回复推送到 IM */
export async function deliverDeferredAutoContinueReply(
  sender: SubagentResultSender,
  commMessage: Message,
  elements: OutputElement[],
): Promise<void> {
  if (!elements.length) return;
  await sender(originFromMessage(commMessage), { text: '', elements });
}
