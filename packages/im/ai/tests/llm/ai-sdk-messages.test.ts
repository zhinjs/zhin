import {
  agentMessagesToAiSdk,
  shouldEnsureToolCallReasoning,
  TOOL_CALL_REASONING_PLACEHOLDER,
  usesAnthropicReasoningProtocol,
} from '../../src/llm/bridge/ai-sdk-messages.js';
import type { AssistantMessage } from '../../src/llm/types/agent-message.js';
import { EMPTY_TOKEN_USAGE } from '../../src/llm/types/agent-message.js';

function toolCallAssistant(overrides?: {
  thinking?: string;
  signature?: string;
}): AssistantMessage {
  const content: AssistantMessage['content'] = [];
  if (overrides?.thinking != null || overrides?.signature != null) {
    content.push({
      type: 'thinking',
      thinking: overrides.thinking ?? '',
      ...(overrides.signature
        ? { providerOptions: { anthropic: { signature: overrides.signature } } }
        : {}),
    });
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

  it('shouldEnsureToolCallReasoning follows model.reasoning but skips Anthropic-protocol SDKs', () => {
    expect(shouldEnsureToolCallReasoning({ reasoning: true })).toBe(true);
    expect(shouldEnsureToolCallReasoning({ reasoning: true, sdk: 'openai-compatible' })).toBe(true);
    expect(shouldEnsureToolCallReasoning({ reasoning: true, sdk: 'minimax' })).toBe(false);
    expect(shouldEnsureToolCallReasoning({ reasoning: true, sdk: 'anthropic' })).toBe(false);
    expect(shouldEnsureToolCallReasoning({ reasoning: false })).toBe(false);
    expect(shouldEnsureToolCallReasoning({})).toBe(false);
  });

  it('usesAnthropicReasoningProtocol covers anthropic and minimax', () => {
    expect(usesAnthropicReasoningProtocol('anthropic')).toBe(true);
    expect(usesAnthropicReasoningProtocol('minimax')).toBe(true);
    expect(usesAnthropicReasoningProtocol('openai-compatible')).toBe(false);
  });

  it('omits unsigned thinking for MiniMax / Anthropic so AI SDK does not warn', () => {
    const messages = agentMessagesToAiSdk(
      [toolCallAssistant({ thinking: 'adaptive cot without signature' })],
      undefined,
      { sdk: 'minimax', ensureToolCallReasoning: true },
    );
    const assistant = messages[0];
    if (assistant?.role !== 'assistant' || !Array.isArray(assistant.content)) {
      throw new Error('expected assistant content parts');
    }
    expect(assistant.content.some((p) => p.type === 'reasoning')).toBe(false);
    expect(assistant.content.some((p) => p.type === 'tool-call')).toBe(true);
  });

  it('round-trips signed Anthropic thinking with providerOptions', () => {
    const messages = agentMessagesToAiSdk(
      [toolCallAssistant({ thinking: 'signed cot', signature: 'sig_abc' })],
      undefined,
      { sdk: 'anthropic' },
    );
    const assistant = messages[0];
    if (assistant?.role !== 'assistant' || !Array.isArray(assistant.content)) {
      throw new Error('expected assistant content parts');
    }
    expect(assistant.content.find((p) => p.type === 'reasoning')).toEqual({
      type: 'reasoning',
      text: 'signed cot',
      providerOptions: { anthropic: { signature: 'sig_abc' } },
    });
  });
});
