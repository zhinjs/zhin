import type { AgentMessage, ToolResultMessage, UserMessage } from '../llm/types/agent-message.js';
import type { ContentBlock } from '../llm/types/content-block.js';
import { estimateTextTokens } from './token-counter.js';
import { IMAGE_MAX_TOKEN_SIZE } from './micro-compact.js';

function blockTokens(block: ContentBlock): number {
  switch (block.type) {
    case 'text': return estimateTextTokens(block.text);
    case 'thinking': return estimateTextTokens(block.thinking);
    case 'toolCall':
      return estimateTextTokens(JSON.stringify({ id: block.id, name: block.name, arguments: block.arguments }));
    // 媒体按已有媒体预算估算，不把 URL / base64 长度当作文本 token。
    // 实际消耗由 provider、分辨率、页数和时长决定，这里不是计费值或上界。
    case 'image':
    case 'audio':
    case 'video':
    case 'file': return IMAGE_MAX_TOKEN_SIZE;
  }
}

export function estimateAgentMessageTokens(message: AgentMessage): number {
  if (message.role !== 'user' && message.role !== 'assistant' && message.role !== 'toolResult') {
    return estimateTextTokens(JSON.stringify(message)) + 4;
  }
  const content = (message as { content: ContentBlock[] }).content;
  let tokens = Array.isArray(content) ? content.reduce((sum, block) => sum + blockTokens(block), 0) : 0;
  if (message.role === 'user') {
    tokens += ((message as UserMessage).media ?? []).reduce((sum, block) => sum + blockTokens(block), 0);
  }
  if (message.role === 'toolResult') {
    const result = message as ToolResultMessage;
    tokens += estimateTextTokens(`${result.toolName}:${result.toolCallId}`);
  }
  return tokens + 4;
}

export function estimateAgentMessagesTokens(messages: AgentMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateAgentMessageTokens(m), 0);
}

/**
 * Ensure compaction keep-boundary does not orphan tool results from their assistant tool_calls.
 */
export function snapCompactionStartIndex(messages: AgentMessage[], startIdx: number): number {
  if (startIdx <= 0 || messages.length === 0) return 0;
  let idx = Math.min(startIdx, messages.length - 1);
  while (idx > 0 && messages[idx]?.role === 'toolResult') {
    idx -= 1;
  }
  return idx;
}

/**
 * Walk from newest messages backward until keepRecentTokens budget is met.
 * Returns index of first kept message (0 = keep all).
 */
export function findKeepRecentStartIndex(
  messages: AgentMessage[],
  keepRecentTokens: number,
  minKeepCount = 2,
): number {
  if (messages.length === 0) return 0;
  let tokens = 0;
  let kept = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    tokens += estimateAgentMessageTokens(messages[i]);
    kept += 1;
    if (tokens >= keepRecentTokens && kept >= minKeepCount) {
      return snapCompactionStartIndex(messages, i);
    }
  }
  return 0;
}
