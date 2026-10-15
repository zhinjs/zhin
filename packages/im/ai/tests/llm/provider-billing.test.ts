/**
 * Out-of-credit errors: never retried, and no fallback to candidates that share the
 * failed model's provider alias (same API key, same empty account).
 */
import { describe, expect, it } from 'vitest';
import {
  ProviderRequestError,
  classifyProviderError,
  createResilientCompletionPort,
  describeProviderFailure,
  type ProviderResilienceEvent,
} from '../../src/llm/provider-resilience.js';
import type { LlmCompletionPort } from '../../src/llm/llm-api-runtime.js';
import type { AssistantMessage } from '../../src/llm/types/agent-message.js';
import type { Context } from '../../src/llm/types/context.js';
import type { Model } from '../../src/llm/types/model.js';

function model(provider: string, id: string): Model {
  return { id, provider, api: 'ai-sdk', sdk: 'openai', reasoning: false, input: ['text'], contextWindow: 8_000, maxTokens: 1_000 } as Model;
}

function reply(text: string): AssistantMessage {
  return {
    role: 'assistant', content: [{ type: 'text', text }], api: 'ai-sdk', provider: 'p', model: 'm',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 } as AssistantMessage['usage'],
    stopReason: 'stop', timestamp: 0,
  };
}

function apiError(statusCode: number, message: string, body?: unknown) {
  return Object.assign(new Error(message), {
    name: 'AI_APICallError', statusCode, responseHeaders: {},
    ...(body ? { responseBody: JSON.stringify(body), data: body } : {}),
  });
}

const ctx = { systemPrompt: '', messages: [] } as unknown as Context;

/** Answers per model id: an Error is thrown, a string is the reply text. */
function run(primary: Model, fallbacks: Model[], answers: Record<string, Error | string>) {
  const calls: string[] = [];
  const base: LlmCompletionPort = {
    async complete(m) {
      calls.push(`${m.provider}/${m.id}`);
      const answer = answers[`${m.provider}/${m.id}`];
      if (answer instanceof Error) throw answer;
      return reply(answer ?? 'unexpected');
    },
    async completeSimple(m, c, o) {
      return this.complete(m, c, o);
    },
  };
  const events: ProviderResilienceEvent[] = [];
  const port = createResilientCompletionPort(base, { fallbackModels: fallbacks, onEvent: (e) => events.push(e), sleep: async () => {}, config: { requestTimeoutMs: 0 } });
  return { result: port.complete(primary, ctx).catch((e: unknown) => e), calls, events };
}

describe('billing classification', () => {
  it.each([
    ['HTTP 402', apiError(402, 'Payment Required')],
    ['DeepSeek 402', apiError(402, 'Insufficient Balance', { error: { message: 'Insufficient Balance', type: 'unknown_error' } })],
    ['OpenRouter 402', apiError(402, 'Insufficient credits. Add more using https://openrouter.ai/settings/credits')],
    ['Anthropic 400', apiError(400, 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.')],
    ['OpenAI 429 insufficient_quota', apiError(429, 'You exceeded your current quota, please check your plan and billing details.', { error: { code: 'insufficient_quota', type: 'insufficient_quota' } })],
  ])('%s is billing, not retryable', (_label, error) => {
    expect(classifyProviderError(error)).toMatchObject({ kind: 'billing', retryable: false });
  });

  it('keeps Gemini free-tier "exceeded your current quota" a rate limit', () => {
    const gemini = apiError(429, 'You exceeded your current quota, please check your plan and billing details.', { error: { code: 429, status: 'RESOURCE_EXHAUSTED' } });
    expect(classifyProviderError(gemini).kind).toBe('rate_limit');
  });
});

describe('billing fallback', () => {
  const broke = () => apiError(402, 'Insufficient Balance');

  it('does not fall back to another model behind the same provider alias', async () => {
    const { result, calls, events } = run(model('deepseek', 'chat'), [model('deepseek', 'reasoner')], { 'deepseek/chat': broke(), 'deepseek/reasoner': 'never' });
    const error = await result;
    expect(calls).toEqual(['deepseek/chat']);
    expect(error).toBeInstanceOf(ProviderRequestError);
    expect(error).toMatchObject({ kind: 'billing', message: describeProviderFailure('billing') });
    expect(events).toEqual([expect.objectContaining({ type: 'give_up', kind: 'billing' })]);
  });

  it('skips same-alias candidates but still tries one on another alias (its own key)', async () => {
    const { result, calls, events } = run(
      model('deepseek', 'chat'),
      [model('deepseek', 'reasoner'), model('openai', 'gpt-4o-mini')],
      { 'deepseek/chat': broke(), 'openai/gpt-4o-mini': 'ok from openai' },
    );
    expect(await result).toMatchObject({ content: [{ text: 'ok from openai' }] });
    expect(calls).toEqual(['deepseek/chat', 'openai/gpt-4o-mini']);
    expect(events).toEqual([expect.objectContaining({ type: 'fallback', from: 'chat', to: 'gpt-4o-mini', kind: 'billing' })]);
  });

  it('leaves other kinds free to fall back within the same alias', async () => {
    const { result, calls } = run(model('gemini', 'flash'), [model('gemini', 'lite')], { 'gemini/flash': apiError(500, 'Internal'), 'gemini/lite': 'ok' });
    expect(await result).toMatchObject({ content: [{ text: 'ok' }] });
    expect(calls).toEqual(['gemini/flash', 'gemini/flash', 'gemini/flash', 'gemini/lite']);
  });
});
