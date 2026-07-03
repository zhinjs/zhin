import type { AgentMessage, AssistantMessage } from './types/agent-message.js';
import { isLlmAgentMessage } from './types/agent-message.js';

const MISSING_TOOL_RESULT_TEXT =
  '[zhin] tool result unavailable (interrupted turn or incomplete history)';

function assistantHasToolCall(message: AgentMessage, toolCallId: string): boolean {
  if (message.role !== 'assistant' || !Array.isArray(message.content)) return false;
  return message.content.some(
    (block) => block.type === 'toolCall' && block.id === toolCallId,
  );
}

function extractAssistantToolCalls(
  message: AssistantMessage,
): Array<{ id: string; name: string }> {
  return message.content
    .filter((block): block is Extract<typeof block, { type: 'toolCall' }> => block.type === 'toolCall')
    .map((block) => ({ id: block.id, name: block.name }));
}

function syntheticToolResult(toolCallId: string, toolName: string): AgentMessage {
  return {
    role: 'toolResult',
    toolCallId,
    toolName,
    content: [{ type: 'text', text: MISSING_TOOL_RESULT_TEXT }],
    isError: true,
    timestamp: Date.now(),
  };
}

/**
 * Normalize history for LLM providers / AI SDK:
 * - Drop toolResult rows with no matching assistant tool_call.
 * - Inject placeholder toolResult rows for assistant tool_calls missing results.
 *
 * Prevents errors such as:
 * - "Messages with role 'tool' must be a response to a preceding message with 'tool_calls'"
 * - AI_MissingToolResultsError
 */
export function repairAgentMessagesForLlm(messages: AgentMessage[]): AgentMessage[] {
  const normalized: AgentMessage[] = [];
  for (const message of messages) {
    if (!isLlmAgentMessage(message)) continue;
    if (message.role === 'toolResult') {
      let matched = false;
      for (let i = normalized.length - 1; i >= 0; i -= 1) {
        const prev = normalized[i]!;
        if (prev.role === 'user') break;
        if (prev.role === 'assistant' && assistantHasToolCall(prev, message.toolCallId)) {
          matched = true;
          break;
        }
      }
      if (!matched) continue;
    }
    normalized.push(message);
  }

  const out: AgentMessage[] = [];
  for (let i = 0; i < normalized.length; i += 1) {
    const message = normalized[i]!;
    if (message.role !== 'assistant' || !Array.isArray(message.content)) {
      out.push(message);
      continue;
    }

    const toolCalls = extractAssistantToolCalls(message);
    out.push(message);
    if (toolCalls.length === 0) continue;

    const resultsById = new Map<string, AgentMessage>();
    let j = i + 1;
    while (j < normalized.length) {
      const next = normalized[j]!;
      if (next.role === 'user' || next.role === 'assistant') break;
      if (next.role === 'toolResult') {
        resultsById.set(next.toolCallId, next);
      }
      j += 1;
    }

    for (const call of toolCalls) {
      const existing = resultsById.get(call.id);
      if (existing) {
        out.push(existing);
      } else {
        out.push(syntheticToolResult(call.id, call.name));
      }
    }

    i = j - 1;
  }

  return out;
}
