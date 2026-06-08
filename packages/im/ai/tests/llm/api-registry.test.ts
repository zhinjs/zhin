import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerApiProvider,
  registerProviderInstance,
  getModel,
  stream,
  complete,
  createAssistantMessageEventStream,
  clearApiRegistryForTests,
  setLegacyProviderResolver,
  createContext,
  createUserMessage,
  EMPTY_TOKEN_USAGE,
  type AssistantMessage,
} from '../../src/llm/index.js';

function mockAssistantMessage(text: string): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'openai-completions',
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

  it('getModel uses live provider models when registry allowlist is empty', () => {
    registerProviderInstance('openai-main', { api: 'openai-completions' }, []);
    setLegacyProviderResolver(() => ({
      name: 'openai-main',
      models: ['mimo-v2.5-pro'],
    }));

    const model = getModel('openai-main', 'mimo-v2.5-pro');
    expect(model.id).toBe('mimo-v2.5-pro');
  });

  it('getModel rejects model not in live discovery list', () => {
    registerProviderInstance('openai-main', { api: 'openai-completions' }, []);
    setLegacyProviderResolver(() => ({
      name: 'openai-main',
      models: ['gpt-4o'],
    }));

    expect(() => getModel('openai-main', 'mimo-v2.5-pro')).toThrow(/not registered/);
  });

  it('getModel prefers explicit registry allowlist over live provider', () => {
    registerProviderInstance('cloudflare-flash', { api: 'cloudflare-workers-ai' }, ['@cf/zai-org/glm-4.7-flash']);
    setLegacyProviderResolver(() => ({
      name: 'cloudflare-flash',
      models: ['other-model'],
    }));

    const model = getModel('cloudflare-flash', '@cf/zai-org/glm-4.7-flash');
    expect(model.id).toBe('@cf/zai-org/glm-4.7-flash');
    expect(() => getModel('cloudflare-flash', 'other-model')).toThrow(/not registered/);
  });

  it('getModel uses live provider models when registry allowlist is empty', () => {
    registerProviderInstance('openai-main', { api: 'openai-completions' }, []);
    setLegacyProviderResolver(() => ({
      name: 'openai-main',
      models: ['mimo-v2.5-pro'],
    }));

    const model = getModel('openai-main', 'mimo-v2.5-pro');
    expect(model.id).toBe('mimo-v2.5-pro');
  });

  it('getModel rejects model not in live discovery list', () => {
    registerProviderInstance('openai-main', { api: 'openai-completions' }, []);
    setLegacyProviderResolver(() => ({
      name: 'openai-main',
      models: ['gpt-4o'],
    }));

    expect(() => getModel('openai-main', 'mimo-v2.5-pro')).toThrow(/not registered/);
  });

  it('getModel prefers explicit registry allowlist over live provider', () => {
    registerProviderInstance('cloudflare-flash', { api: 'cloudflare-workers-ai' }, ['@cf/zai-org/glm-4.7-flash']);
    setLegacyProviderResolver(() => ({
      name: 'cloudflare-flash',
      models: ['other-model'],
    }));

    const model = getModel('cloudflare-flash', '@cf/zai-org/glm-4.7-flash');
    expect(model.id).toBe('@cf/zai-org/glm-4.7-flash');
    expect(() => getModel('cloudflare-flash', 'other-model')).toThrow(/not registered/);
  });

  it('getModel resolves registered provider', () => {
    registerProviderInstance('openai', {
      api: 'openai-completions',
      apiKey: 'k',
      baseUrl: 'https://api.example.com/v1',
    }, ['gpt-test']);

    const model = getModel('openai', 'gpt-test');
    expect(model.provider).toBe('openai');
    expect(model.api).toBe('openai-completions');
    expect(model.id).toBe('gpt-test');
  });

  it('stream delegates to registered api provider', async () => {
    registerProviderInstance('openai', { api: 'openai-completions' }, ['gpt-test']);
    registerApiProvider({
      api: 'openai-completions',
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

    const model = getModel('openai', 'gpt-test');
    const ctx = createContext('sys', [createUserMessage('hello')]);
    const result = await complete(model, ctx);
    expect(result.content[0]).toEqual({ type: 'text', text: 'hello' });
  });

  it('stream throws when api not registered', () => {
    registerProviderInstance('openai', { api: 'openai-completions' }, ['gpt-test']);
    const model = getModel('openai', 'gpt-test');
    expect(() => stream(model, createContext(''))).toThrow(/No ApiProvider registered/);
  });
});
