import type { AgentMessageExtra, UserMessage } from '@zhin.js/ai';
import type { Message } from '@zhin.js/core';
import { resolveTurnUserMessage } from './session-io.js';

export function buildTurnUserMessages(
  commMessage: Message,
  rawContent: string,
): {
  rawContent: string;
  userMessageExtra?: AgentMessageExtra;
  promptMessages: UserMessage[];
} {
  const { content, extra, llmMessage } = resolveTurnUserMessage(commMessage as import('@zhin.js/core').AgentTurnMessage, rawContent);
  return {
    rawContent: content,
    userMessageExtra: extra,
    promptMessages: [llmMessage],
  };
}
