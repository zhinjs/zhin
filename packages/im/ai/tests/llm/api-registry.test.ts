import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerApiProvider,
  registerProviderInstance,
  getLlmTransportModel,
  stream,
  complete,
  createAssistantMessageEventStream,
  clearApiRegistryForTests,
  setLiveModelsResolver,
  createContext,
  createUserMessage,
  EMPTY_TOKEN_USAGE,
  type AssistantMessage,
} from '../../src/llm/index.js';

function mockAssistantMessage(text: string): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'ai-sdk',
    provider: 'test',
    model: 'gpt-test',
    usage: EMPTY_TOKEN_USAGE,
    stopReason: 'stop',
    timestamp: Date.now(),
  };
}

describe('llm api-registry', () => {
  beforeEach(() => {
    clearApiRegistryForTests();
  });

  it('getLlmTransportModel uses live provider models when registry allowlist is empty', () => {
    registerProviderInstance('openai-main', { sdk: 'openai' }, []);
    setLiveModelsResolver(() => ['mimo-v2.5-pro']);

    const model = getLlmTransportModel('openai-main', 'mimo-v2.5-pro');
    expect(model.id).toBe('mimo-v2.5-pro');
  });

  it('getLlmTransportModel rejects model not in live discovery list', () => {
    registerProviderInstance('openai-main', { sdk: 'openai' }, []);
    setLiveModelsResolver(() => ['gpt-4o']);

    expect(() => getLlmTransportModel('openai-main', 'mimo-v2.5-pro')).toThrow(/not registered/);
  });

  it('getLlmTransportModel prefers explicit registry allowlist over live provider', () => {
    registerProviderInstance('cloudflare-flash', { sdk: 'openai-compatible', accountId: 'acc' }, ['@cf/zai-org/glm-4.7-flash']);
    setLiveModelsResolver(() => ['other-model']);

    const model = getLlmTransportModel('cloudflare-flash', '@cf/zai-org/glm-4.7-flash');
    expect(model.id).toBe('@cf/zai-org/glm-4.7-flash');
    expect(() => getLlmTransportModel('cloudflare-flash', 'other-model')).toThrow(/not registered/);
  });

  it('getLlmTransportModel resolves registered provider', () => {
    registerProviderInstance('openai', {
      sdk: 'openai',
      apiKey: 'k',
      baseUrl: 'https://api.example.com/v1',
    }, ['gpt-test']);

    const model = getLlmTransportModel('openai', 'gpt-test');
    expect(model.provider).toBe('openai');
    expect(model.api).toBe('ai-sdk');
    expect(model.id).toBe('gpt-test');
  });

  it('getLlmTransportModel uses provider contextWindow override', () => {
    registerProviderInstance('opencode', {
      sdk: 'openai-compatible',
      baseUrl: 'https://opencode.ai/zen/v1',
      contextWindow: 32_768,
    }, ['mimo-v2.5-free']);
    const model = getLlmTransportModel('opencode', 'mimo-v2.5-free');
    expect(model.contextWindow).toBe(32_768);
    expect(model.reasoning).toBe(true);
  });

  it('stream delegates to registered api provider', async () => {
    registerProviderInstance('openai', { sdk: 'openai' }, ['gpt-test']);
    registerApiProvider({
      api: 'ai-sdk',
      stream(_model, context) {
        const text = context.messages[0]?.role === 'user'
          ? context.messages[0].content.find((b) => b.type === 'text')?.text ?? ''
          : '';
        return createAssistantMessageEventStream(async (push) => {
          push({ type: 'text_delta', text });
          const message = mockAssistantMessage(text);
          return message;
        });
      },
    });

    const model = getLlmTransportModel('openai', 'gpt-test');
    const ctx = createContext('sys', [createUserMessage('hello')]);
    const result = await complete(model, ctx);
    expect(result.content[0]).toEqual({ type: 'text', text: 'hello' });
  });

  it('stream throws when api not registered', () => {
    registerProviderInstance('openai', { sdk: 'openai' }, ['gpt-test']);
    const model = getLlmTransportModel('openai', 'gpt-test');
    expect(() => stream(model, createContext(''))).toThrow(/No ApiProvider registered/);
  });
});
