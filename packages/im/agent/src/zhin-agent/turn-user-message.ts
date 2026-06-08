import type { AgentMessageExtra, UserMessage } from '@zhin.js/ai';
import type { ToolContext } from '@zhin.js/core';
import { resolveTurnUserMessage } from './session-io.js';

export function buildTurnUserMessages(
  context: ToolContext,
  rawContent: string,
): {
  rawContent: string;
  userMessageExtra?: AgentMessageExtra;
  promptMessages: UserMessage[];
} {
  const { content, extra, llmMessage } = resolveTurnUserMessage(context, rawContent);
  return {
    rawContent: content,
    userMessageExtra: extra,
    promptMessages: [llmMessage],
  };
}
