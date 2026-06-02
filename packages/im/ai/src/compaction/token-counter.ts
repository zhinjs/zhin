import type { ChatMessage } from '../types.js';

export function estimateTokens(message: ChatMessage): number {
  const content = typeof message.content === 'string'
    ? message.content
    : JSON.stringify(message.content);
  const reasoning =
    typeof message.reasoning_content === 'string' ? message.reasoning_content : '';
  return Math.ceil((content.length + reasoning.length) / 4) + 4;
}

export function estimateMessagesTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m), 0);
}
