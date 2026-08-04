import { type AgentMessage, type AssistantMessage, type ToolResultMessage, type UserMessage, isLlmAgentMessage } from './types/agent-message.js';
type LlmAgentMessage = UserMessage | AssistantMessage | ToolResultMessage;

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
  const normalized: LlmAgentMessage[] = [];
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

    const toolCalls = extractAssistantToolCalls(message as AssistantMessage);
    out.push(message);
    if (toolCalls.length === 0) continue;

    const resultsById = new Map<string, AgentMessage>();
    let j = i + 1;
    while (j < normalized.length) {
      const next = normalized[j]!;
      if (next.role === 'user' || next.role === 'assistant') break;
      if (next.role === 'toolResult' && typeof next.toolCallId === 'string') {
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

/**
 * 增量修复器：为 append-only 消息流的循环调用方（agentLoop）持有修复不变量。
 * 修复边界取最后一个 user 消息——边界前的回合组已闭合，修复结果不随追加变化；
 * 每次转换只重修边界后的活跃尾部。历史被整体替换（压缩/transform）时 reset()。
 */
export function createIncrementalRepair(): {
  reset(): void;
  repair(messages: AgentMessage[]): AgentMessage[];
} {
  let repairedPrefix: AgentMessage[] = [];
  let prefixEnd = 0; // raw[0..prefixEnd) 已修复；prefixEnd 处为 user 消息或 0
  return {
    reset() {
      repairedPrefix = [];
      prefixEnd = 0;
    },
    repair(messages: AgentMessage[]): AgentMessage[] {
      let boundary = -1;
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        if (messages[i]?.role === 'user') {
          boundary = i;
          break;
        }
      }
      const targetEnd = boundary >= 0 ? boundary : 0;
      if (targetEnd < prefixEnd) this.reset();
      if (targetEnd > prefixEnd) {
        repairedPrefix = repairedPrefix.concat(
          repairAgentMessagesForLlm(messages.slice(prefixEnd, targetEnd)),
        );
        prefixEnd = targetEnd;
      }
      return repairedPrefix.concat(repairAgentMessagesForLlm(messages.slice(prefixEnd)));
    },
  };
}
