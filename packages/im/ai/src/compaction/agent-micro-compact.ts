import type { AgentMessage, ToolResultMessage } from '../llm/types/agent-message.js';
import { CLEARED_MESSAGE, COMPACTABLE_TOOLS } from './micro-compact.js';
import { estimateAgentMessageTokens } from './agent-message-tokens.js';

export interface AgentMicroCompactResult {
  messages: AgentMessage[];
  didCompact: boolean;
  clearedCount: number;
  savedTokens: number;
}

export interface AgentMicroCompactOptions {
  keepRecentToolResults?: number;
  tokenThreshold?: number;
  force?: boolean;
}

function toolResultText(message: ToolResultMessage): string {
  return message.content
    .filter(b => b.type === 'text')
    .map(b => (b.type === 'text' ? b.text : ''))
    .join('\n');
}

/**
 * L1 micro-compact for AgentMessage[] — strip old tool results without LLM.
 */
export function microCompactAgentMessages(
  messages: AgentMessage[],
  options: AgentMicroCompactOptions = {},
): AgentMicroCompactResult {
  const keepRecent = options.keepRecentToolResults ?? 6;
  const threshold = options.tokenThreshold ?? 0;
  const totalTokens = messages.reduce((s, m) => s + estimateAgentMessageTokens(m), 0);

  if (!options.force && threshold > 0 && totalTokens < threshold) {
    return { messages, didCompact: false, clearedCount: 0, savedTokens: 0 };
  }

  const toolIndices: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === 'toolResult') toolIndices.push(i);
  }

  if (toolIndices.length <= keepRecent) {
    return { messages, didCompact: false, clearedCount: 0, savedTokens: 0 };
  }

  const toClear = toolIndices.slice(0, toolIndices.length - keepRecent);
  let clearedCount = 0;
  let savedTokens = 0;
  const out = messages.map((msg, idx) => {
    if (!toClear.includes(idx) || msg.role !== 'toolResult') return msg;
    const tr = msg as ToolResultMessage;
    if (!COMPACTABLE_TOOLS.has(tr.toolName)) return msg;
    const before = estimateAgentMessageTokens(tr);
    const after = estimateAgentMessageTokens({
      ...tr,
      content: [{ type: 'text', text: CLEARED_MESSAGE }],
    });
    clearedCount += 1;
    savedTokens += Math.max(0, before - after);
    return {
      ...tr,
      content: [{ type: 'text', text: CLEARED_MESSAGE }],
    } satisfies ToolResultMessage;
  });

  return {
    messages: out,
    didCompact: clearedCount > 0,
    clearedCount,
    savedTokens,
  };
}
