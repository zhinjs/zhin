import type { ChatMessage } from '../types.js';

export function estimateTokens(message: ChatMessage): number {
  const content = typeof message.content === 'string'
    ? message.content
    : JSON.stringify(message.content);
  return Math.ceil(content.length / 4) + 4;
}

export function estimateMessagesTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m), 0);
}
