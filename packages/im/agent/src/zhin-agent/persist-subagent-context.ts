/**
 * Persist async subagent result into main session context before auto-continue.
 */
import {
  EMPTY_TOKEN_USAGE,
  type AssistantMessage,
} from '@zhin.js/ai';
import { resolveAgentTurnSessionKey } from '../collaboration/resolve-agent-session-key.js';
import type { SubagentCompletePayload } from '../subagent.js';
import { packageSubagentResult } from '../subagent-artifact.js';
import type { Message } from '../orchestrator/types.js';
import type { ZhinAgentPrivate } from './zhin-agent-private.js';

export async function persistSubagentResultToContext(
  agent: ZhinAgentPrivate,
  commMessage: Message,
  payload: SubagentCompletePayload,
): Promise<boolean> {
  const body = payload.result.trim();
  if (!body) return false;

  const sessionKey = resolveAgentTurnSessionKey(commMessage);
  const active = await agent.agentSessionStore.findActive(sessionKey);
  const sessionId = active?.session_id;
  if (!sessionId) return false;

  const packaged = packageSubagentResult(body, payload.taskId);
  const text = [
    `[Subagent completed · task:${payload.taskId} · ${payload.label}]`,
    `status: ${payload.status}`,
    '',
    packaged.text,
  ].join('\n');

  const assistantMessage: AssistantMessage = {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'openai-completions',
    provider: 'subagent',
    model: payload.agent ?? 'subagent',
    usage: EMPTY_TOKEN_USAGE,
    stopReason: 'stop',
    timestamp: Date.now(),
  };

  await agent.contextRepository.appendMessages(sessionId, [assistantMessage]);
  return true;
}
