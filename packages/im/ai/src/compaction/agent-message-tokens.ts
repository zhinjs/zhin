import type { AgentMessage, AssistantMessage, ToolResultMessage } from '../llm/types/agent-message.js';
import { assistantText } from '../llm/convert/openai-bridge.js';

function blockText(block: { type: string; text?: string; thinking?: string }): string {
  if (block.type === 'text' && block.text) return block.text;
  if (block.type === 'thinking' && block.thinking) return block.thinking;
  return '';
}

export function estimateAgentMessageTokens(message: AgentMessage): number {
  let text = '';
  if (message.role === 'user' || message.role === 'assistant' || message.role === 'toolResult') {
    const blocks = (message as { content: Array<{ type: string; text?: string; thinking?: string }> }).content;
    if (Array.isArray(blocks)) {
      text = blocks.map(blockText).join('\n');
    }
    if (message.role === 'assistant') {
      text = assistantText(message as AssistantMessage) || text;
    }
    if (message.role === 'toolResult') {
      const tr = message as ToolResultMessage;
      text = `${tr.toolName}:${text}`;
    }
  } else {
    text = JSON.stringify(message);
  }
  return Math.ceil(text.length / 4) + 4;
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
