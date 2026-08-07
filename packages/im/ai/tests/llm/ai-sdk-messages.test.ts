import {
  agentMessagesToAiSdk,
  shouldEnsureToolCallReasoning,
  TOOL_CALL_REASONING_PLACEHOLDER,
} from '../../src/llm/bridge/ai-sdk-messages.js';
import type { AssistantMessage } from '../../src/llm/types/agent-message.js';
import { EMPTY_TOKEN_USAGE } from '../../src/llm/types/agent-message.js';

function toolCallAssistant(overrides?: {
  thinking?: string;
}): AssistantMessage {
  const content: AssistantMessage['content'] = [];
  if (overrides?.thinking != null) {
    content.push({ type: 'thinking', thinking: overrides.thinking });
  }
  content.push({
    type: 'toolCall',
    id: 'call_1',
    name: 'discover',
    arguments: { query: 'weather' },
  });
  return {
    role: 'assistant',
    content,
    api: 'ai-sdk',
    provider: 'opencode',
    model: 'deepseek-v4-flash-free',
    usage: { ...EMPTY_TOKEN_USAGE },
    stopReason: 'toolCalls',
    timestamp: Date.now(),
  };
}

describe('agentMessagesToAiSdk tool-call reasoning', () => {
  it('injects placeholder reasoning when toolCall assistant has no thinking', () => {
    const messages = agentMessagesToAiSdk([toolCallAssistant()], undefined, {
      ensureToolCallReasoning: true,
    });
    const assistant = messages[0];
    expect(assistant?.role).toBe('assistant');
    if (assistant?.role !== 'assistant' || !Array.isArray(assistant.content)) {
      throw new Error('expected assistant content parts');
    }
    const reasoning = assistant.content.find((p) => p.type === 'reasoning');
    expect(reasoning).toEqual({
      type: 'reasoning',
      text: TOOL_CALL_REASONING_PLACEHOLDER,
    });
    expect(assistant.content.some((p) => p.type === 'tool-call')).toBe(true);
  });

  it('preserves real thinking text for toolCall assistants', () => {
    const messages = agentMessagesToAiSdk(
      [toolCallAssistant({ thinking: 'need weather tool' })],
      undefined,
      { ensureToolCallReasoning: true },
    );
    const assistant = messages[0];
    if (assistant?.role !== 'assistant' || !Array.isArray(assistant.content)) {
      throw new Error('expected assistant content parts');
    }
    expect(assistant.content.find((p) => p.type === 'reasoning')).toEqual({
      type: 'reasoning',
      text: 'need weather tool',
    });
  });

  it('does not inject placeholder when ensureToolCallReasoning is off', () => {
    const messages = agentMessagesToAiSdk([toolCallAssistant()]);
    const assistant = messages[0];
    if (assistant?.role !== 'assistant' || !Array.isArray(assistant.content)) {
      throw new Error('expected assistant content parts');
    }
    expect(assistant.content.some((p) => p.type === 'reasoning')).toBe(false);
  });

  it('shouldEnsureToolCallReasoning follows model.reasoning', () => {
    expect(shouldEnsureToolCallReasoning({ reasoning: true })).toBe(true);
    expect(shouldEnsureToolCallReasoning({ reasoning: false })).toBe(false);
    expect(shouldEnsureToolCallReasoning({})).toBe(false);
  });
});
