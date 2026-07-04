/**
 * Async subagent completion — wake main agent with persisted sub-agent output.
 */
import { createUserMessage, type UserMessage } from '@zhin.js/ai';

export const SUBAGENT_AUTO_CONTINUE_MARKER = '[Subagent completed — auto-continue]';

export function buildSubagentAutoContinueUserMessage(
  taskId: string,
  label: string,
  status: 'ok' | 'error',
): UserMessage {
  const text = [
    SUBAGENT_AUTO_CONTINUE_MARKER,
    `Task [${taskId}] · ${label}`,
    `Sub-agent status: ${status}.`,
    'Continue from the sub-agent output already appended to this session context.',
    'Summarize for the user or take the next orchestration step; do not paste the full raw sub-agent output verbatim.',
  ].join('\n');
  return createUserMessage(text);
}
