import { SyntheticCompletionRuntime } from '../helpers/synthetic-completion-runtime.js';
import { describe, it, expect } from 'vitest';
import {
  createAssistantMessageEventStream,
  createContext,
  createUserMessage,
  EMPTY_TOKEN_USAGE,
  type AssistantMessage,
} from '../../src/llm/index.js';

import { graphFixture, context } from '../provider/fixtures.js';
import { normalizeProviderGraph, resolveProviderProfile } from '../../src/provider/index.js';

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

describe('SyntheticCompletionRuntime', () => {
  it('requires an explicit deployment chat selection instead of auto-selecting live-discovered IDs', () => {
    const original = graphFixture();
    const graph = normalizeProviderGraph({ ...original, purposes: { defaults: {} } });
    expect(() => resolveProviderProfile({ graph, context, kind: 'language', purpose: 'chat' })).toThrow('not-configured');
  });

  it('rejects a Profile outside its explicit Service catalog', () => {
    const original = graphFixture();
    expect(() => normalizeProviderGraph({ ...original, profiles: { text: { ...original.profiles.text, model: 'not-configured' } } })).toThrow('invalid-graph');
  });

  it('retains the selected explicit model rather than adding a discovered candidate', () => {
    const graph = graphFixture();
    expect(resolveProviderProfile({ graph, context, kind: 'language', purpose: 'chat' }).model.id).toBe('text');
    expect(graph.services.service.models).not.toHaveProperty('discovered-outside-model');
  });

  it('keeps exact Service and Account identity in the immutable execution binding', () => {
    const graph = graphFixture();
    const binding = resolveProviderProfile({ graph, context, kind: 'language', purpose: 'chat' });
    expect(binding).toMatchObject({ service: { id: 'service', driver: { owner: 'root/providers' } }, account: { id: 'account', incarnation: 'first' }, model: { id: 'text' } });
    expect(binding.profile).not.toHaveProperty('apiKey');
  });

  it('preserves explicit model input and native context metadata without model-name inference', () => {
    const original = graphFixture();
    const graph = normalizeProviderGraph({ ...original, services: { service: { ...original.services.service, models: { ...original.services.service.models,
      text: { ...original.services.service.models.text, input: ['text', 'image', 'audio', 'video', 'file'], contextWindow: 32768 } } } } });
    const binding = resolveProviderProfile({ graph, context, kind: 'language', purpose: 'chat' });
    expect(binding.model.input).toEqual(['text', 'image', 'audio', 'video', 'file']); expect(binding.model.contextWindow).toBe(32768);
  });

  it('delegates completion to its registered transport', async () => {
    const runtime = new SyntheticCompletionRuntime();
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
    const left = new SyntheticCompletionRuntime();
    const right = new SyntheticCompletionRuntime();
    left.registerProvider('openai', { sdk: 'openai' }, ['gpt-test']);
    const model = left.model('openai', 'gpt-test');
    expect(() => right.model('openai', 'gpt-test')).toThrow(/Unknown provider/);
    expect(() => left.stream(model, createContext(''))).toThrow(/No ApiProvider registered/);
  });
});
