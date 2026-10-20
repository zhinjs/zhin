import { describe, it, expect } from 'vitest';
import { createUserMessage, type AgentMessage } from '../../src/llm/types/agent-message.js';
import {
  findKeepRecentStartIndex,
  snapCompactionStartIndex,
} from '../../src/compaction/agent-message-tokens.js';
import { repairAgentMessagesForLlm } from '../../src/llm/repair-agent-messages.js';

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
      // AgentMessage 层不变式：toolResult 不得孤立（须有携带同名 toolCall 的 assistant 前驱）
      for (let i = 0; i < kept.length; i += 1) {
        const msg = kept[i];
        if (msg?.role !== 'toolResult') continue;
        const prev = kept[i - 1];
        expect(prev?.role).toBe('assistant');
        const calls = prev?.role === 'assistant'
          ? prev.content.filter((b) => b.type === 'toolCall')
          : [];
        expect(calls.some((tc) => tc.type === 'toolCall' && tc.id === msg.toolCallId)).toBe(true);
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
