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
    'Decide whether the user goal is done.',
    'If done: reply to the user with a short confirmation (what was done / outcome).',
    'If not done: take the next orchestration step (tools / another spawn).',
    'Do not paste the full raw sub-agent output verbatim.',
  ].join('\n');
  return createUserMessage(text);
}

/** 首轮 auto-continue 空回复时再催一次：必须给出用户可见总结 */
export function buildSubagentAutoContinueRetryMessage(
  taskId: string,
  label: string,
  status: 'ok' | 'error',
): UserMessage {
  const text = [
    SUBAGENT_AUTO_CONTINUE_MARKER,
    `Task [${taskId}] · ${label}`,
    `Sub-agent status: ${status}.`,
    'Your previous auto-continue turn produced no user-visible reply.',
    'Based on the sub-agent output in session context, write a short user-facing confirmation now.',
    'State clearly whether the requested work succeeded or failed.',
    'Do not call tools unless absolutely necessary to finish; prefer a direct reply.',
  ].join('\n');
  return createUserMessage(text);
}
