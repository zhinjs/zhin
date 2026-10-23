import { createUserMessage, EMPTY_TOKEN_USAGE, type AssistantMessage } from '../../src/llm/types/agent-message.js';
import type { MediaContentBlock } from '../../src/llm/types/content-block.js';
import { estimateAgentMessageTokens } from '../../src/compaction/agent-message-tokens.js';
import { estimateTextTokens } from '../../src/compaction/token-counter.js';

const assistant = (content: AssistantMessage['content']): AssistantMessage => ({
  role: 'assistant', content, timestamp: 1, api: 'test', provider: 'test', model: 'test',
  usage: EMPTY_TOKEN_USAGE, stopReason: 'stop',
});

describe('AgentMessage request budget', () => {
  it('counts long tool arguments even when the assistant also has text', () => {
    const message = assistant([
      { type: 'text', text: '正在查询' },
      { type: 'toolCall', id: 'call-1', name: 'lookup', arguments: { query: 'x'.repeat(40_000) } },
    ]);
    expect(estimateAgentMessageTokens(message)).toBeGreaterThan(10_000);
  });

  it('counts thinking alongside text instead of replacing it', () => {
    const text = { type: 'text' as const, text: '结论' };
    expect(estimateAgentMessageTokens(assistant([text, { type: 'thinking', thinking: '分析'.repeat(200) }])))
      .toBeGreaterThanOrEqual(estimateAgentMessageTokens(assistant([text])) + 400);
  });

  it.each(['image', 'audio', 'video', 'file'] as const)('budgets %s without treating base64 bytes as text tokens', (type) => {
    const media = (size: number): MediaContentBlock => ({ type, data: { media: { kind: 'base64', value: 'A'.repeat(size) } } });
    const plain = createUserMessage('看看');
    const small = createUserMessage('看看', [media(10)]);
    const large = createUserMessage('看看', [media(400_000)]);
    expect(estimateAgentMessageTokens(small)).toBeGreaterThan(estimateAgentMessageTokens(plain));
    expect(estimateAgentMessageTokens(large)).toBe(estimateAgentMessageTokens(small));
    expect(estimateAgentMessageTokens({ role: 'toolResult', toolCallId: 'c', toolName: 'read', content: [media(10)], isError: false, timestamp: 1 }))
      .toBeGreaterThan(100);
  });

  it('keeps the existing text estimate and does not count stored usage as request content', () => {
    expect(estimateAgentMessageTokens(createUserMessage('中文hello'))).toBe(estimateTextTokens('中文hello') + 4);
    const message = assistant([{ type: 'text', text: 'hello' }]);
    expect(estimateAgentMessageTokens({ ...message, usage: { ...EMPTY_TOKEN_USAGE, input: 100_000, totalTokens: 100_000 } }))
      .toBe(estimateAgentMessageTokens(message));
  });
});
