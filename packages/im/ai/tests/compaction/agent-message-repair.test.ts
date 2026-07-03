import { describe, it, expect } from 'vitest';
import { createUserMessage } from '../../src/llm/types/agent-message.js';
import {
  findKeepRecentStartIndex,
  snapCompactionStartIndex,
} from '../../src/compaction/agent-message-tokens.js';
import { repairAgentMessagesForLlm } from '../../src/llm/repair-agent-messages.js';
import { agentMessagesToOpenAi } from '../../src/llm/convert/openai-bridge.js';
import type { AgentMessage } from '../../src/llm/types/agent-message.js';

function assistantWithToolCall(id: string, name = 'echo'): AgentMessage {
  return {
    role: 'assistant',
    content: [
      { type: 'toolCall', id, name, arguments: {} },
    ],
    api: 'openai-completions',
    provider: 'openai',
    model: 'test',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'toolCalls',
    timestamp: 1,
  };
}

function toolResult(id: string, name = 'echo'): AgentMessage {
  return {
    role: 'toolResult',
    toolCallId: id,
    toolName: name,
    content: [{ type: 'text', text: 'ok' }],
    isError: false,
    timestamp: 2,
  };
}

describe('snapCompactionStartIndex', () => {
  it('walks back from toolResult to its assistant', () => {
    const messages: AgentMessage[] = [
      createUserMessage('old'),
      assistantWithToolCall('c1'),
      toolResult('c1'),
      createUserMessage('recent'),
    ];
    expect(snapCompactionStartIndex(messages, 2)).toBe(1);
  });
});

describe('findKeepRecentStartIndex', () => {
  it('does not start keep region on orphaned toolResult', () => {
    const messages: AgentMessage[] = [
      createUserMessage('a'.repeat(400)),
      assistantWithToolCall('c1'),
      toolResult('c1'),
      createUserMessage('recent'),
    ];
    const startIdx = findKeepRecentStartIndex(messages, 10, 2);
    expect(messages[startIdx]?.role).not.toBe('toolResult');
    if (startIdx > 0 && startIdx < messages.length) {
      const kept = messages.slice(startIdx);
      const openAi = agentMessagesToOpenAi(kept);
      for (let i = 0; i < openAi.length; i += 1) {
        if (openAi[i]?.role === 'tool') {
          const prev = openAi[i - 1];
          expect(prev?.role).toBe('assistant');
          expect(prev?.tool_calls?.some((tc) => tc.id === openAi[i]?.tool_call_id)).toBe(true);
        }
      }
    }
  });
});

describe('repairAgentMessagesForLlm', () => {
  it('drops toolResult without preceding assistant tool_call', () => {
    const repaired = repairAgentMessagesForLlm([
      createUserMessage('hi'),
      toolResult('orphan'),
    ]);
    expect(repaired).toHaveLength(1);
    expect(repaired[0]?.role).toBe('user');
  });

  it('keeps toolResult when assistant tool_call is present', () => {
    const repaired = repairAgentMessagesForLlm([
      createUserMessage('hi'),
      assistantWithToolCall('c1'),
      toolResult('c1'),
    ]);
    expect(repaired).toHaveLength(3);
  });

  it('injects placeholder toolResult for assistant tool_call without result', () => {
    const repaired = repairAgentMessagesForLlm([
      createUserMessage('hi'),
      assistantWithToolCall('call_01_kdW2pwwVx78HWeGlJg576418'),
      createUserMessage('next'),
    ]);
    expect(repaired).toHaveLength(4);
    expect(repaired[1]?.role).toBe('assistant');
    expect(repaired[2]?.role).toBe('toolResult');
    expect(repaired[2]).toMatchObject({
      toolCallId: 'call_01_kdW2pwwVx78HWeGlJg576418',
      isError: true,
    });
    expect(repaired[3]?.role).toBe('user');
  });
});
