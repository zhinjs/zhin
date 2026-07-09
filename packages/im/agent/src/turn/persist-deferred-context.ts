/**
 * Deferred worker 完成后将结果写入主会话 ContextRepository，
 * 避免下一轮主 Agent 仍只看到 run_deferred_task 的 delegated 占位。
 */
import {
  EMPTY_TOKEN_USAGE,
  type AssistantMessage,
} from '@zhin.js/ai';
import { resolveAgentTurnSessionKey } from '../collaboration/resolve-agent-session-key.js';
import type { DeferredWorkerResult } from '../deferred-worker-runner.js';
import { resolveSubagentDisplayLabel } from '../subagent-goal-notify.js';
import { packageSubagentResult } from '../subagent-artifact.js';
import type { Message } from '../orchestrator/types.js';
import type { ZhinAgentPrivate } from '../internal/agent-host.js';
import { extractDeferredBody } from './deferred-delivery.js';

export async function persistDeferredWorkerResultToContext(
  agent: ZhinAgentPrivate,
  commMessage: Message,
  taskId: string,
  goal: string,
  result: DeferredWorkerResult,
): Promise<boolean> {
  const body = extractDeferredBody(result);
  if (!body.trim()) return false;

  const sessionKey = resolveAgentTurnSessionKey(commMessage);
  const active = await agent.agentSessionStore.findActive(sessionKey);
  const sessionId = active?.session_id;
  if (!sessionId) return false;

  const label = resolveSubagentDisplayLabel(undefined, goal);
  const packaged = packageSubagentResult(body, taskId);
  const text = `[Deferred worker 完成 · task:${taskId} · ${label}]\n\n${packaged.text}`;

  const assistantMessage: AssistantMessage = {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'openai-completions',
    provider: 'deferred-worker',
    model: 'worker',
    usage: EMPTY_TOKEN_USAGE,
    stopReason: 'stop',
    timestamp: Date.now(),
  };

  await agent.contextRepository.appendMessages(sessionId, [assistantMessage]);
  return true;
}
