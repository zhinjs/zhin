import { describe, it, expect } from 'vitest';
import {
  LlmApiRuntime,
  createAssistantMessageEventStream,
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

describe('LlmApiRuntime', () => {
  it('uses owner-local live models when the explicit allowlist is empty', () => {
    const runtime = new LlmApiRuntime(() => ['mimo-v2.5-pro']);
    runtime.registerProvider('openai-main', { sdk: 'openai' });
    expect(runtime.model('openai-main', 'mimo-v2.5-pro').id).toBe('mimo-v2.5-pro');
  });

  it('rejects a model outside live discovery', () => {
    const runtime = new LlmApiRuntime(() => ['gpt-4o']);
    runtime.registerProvider('openai-main', { sdk: 'openai' });
    expect(() => runtime.model('openai-main', 'mimo-v2.5-pro')).toThrow(/not registered/);
  });

  it('prefers an explicit allowlist over live discovery', () => {
    const runtime = new LlmApiRuntime(() => ['other-model']);
    runtime.registerProvider(
      'cloudflare-flash',
      { sdk: 'openai-compatible', accountId: 'acc' },
      ['@cf/zai-org/glm-4.7-flash'],
    );
    expect(runtime.model('cloudflare-flash', '@cf/zai-org/glm-4.7-flash').id)
      .toBe('@cf/zai-org/glm-4.7-flash');
    expect(() => runtime.model('cloudflare-flash', 'other-model')).toThrow(/not registered/);
  });

  it('builds transport metadata from the registered provider', () => {
    const runtime = new LlmApiRuntime();
    runtime.registerProvider('openai', {
      sdk: 'openai',
      apiKey: 'k',
      baseUrl: 'https://api.example.com/v1',
    }, ['gpt-test']);
    const model = runtime.model('openai', 'gpt-test');
    expect(model).toMatchObject({ provider: 'openai', api: 'ai-sdk', id: 'gpt-test' });
    expect(model.input).toEqual(['text']);
  });

  it('preserves input modalities and context-window overrides', () => {
    const runtime = new LlmApiRuntime();
    runtime.registerProvider('multimodal', {
      sdk: 'openai',
      input: ['text', 'image', 'audio', 'video', 'file'],
      contextWindow: 32_768,
    }, ['omni']);
    const model = runtime.model('multimodal', 'omni');
    expect(model.input).toEqual(['text', 'image', 'audio', 'video', 'file']);
    expect(model.contextWindow).toBe(32_768);
  });

  it('delegates completion to its registered transport', async () => {
    const runtime = new LlmApiRuntime();
    runtime.registerProvider('openai', { sdk: 'openai' }, ['gpt-test']);
    runtime.registerApiProvider({
      api: 'ai-sdk',
      stream(_model, context) {
        const text = context.messages[0]?.role === 'user'
          ? context.messages[0].content.find((block) => block.type === 'text')?.text ?? ''
          : '';
        return createAssistantMessageEventStream(async (push) => {
          push({ type: 'text_delta', text });
          return mockAssistantMessage(text);
        });
      },
    });
    const result = await runtime.complete(
      runtime.model('openai', 'gpt-test'),
      createContext('sys', [createUserMessage('hello')]),
    );
    expect(result.content[0]).toEqual({ type: 'text', text: 'hello' });
  });

  it('keeps provider and transport state isolated between owners', () => {
    const left = new LlmApiRuntime();
    const right = new LlmApiRuntime();
    left.registerProvider('openai', { sdk: 'openai' }, ['gpt-test']);
    const model = left.model('openai', 'gpt-test');
    expect(() => right.model('openai', 'gpt-test')).toThrow(/Unknown provider/);
    expect(() => left.stream(model, createContext(''))).toThrow(/No ApiProvider registered/);
  });
});
