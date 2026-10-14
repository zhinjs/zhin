import { describe, expect, it, vi } from 'vitest';
import {
  ProviderRequestError,
  classifyProviderError,
  computeBackoffDelay,
  createResilientCompletionPort,
  parseRetryAfterMs,
  resolveProviderResilienceConfig,
  type ProviderResilienceEvent,
} from '../../src/llm/provider-resilience.js';
import type { LlmCompletionPort } from '../../src/llm/llm-api-runtime.js';
import type { AssistantMessage } from '../../src/llm/types/agent-message.js';
import type { Model } from '../../src/llm/types/model.js';
import type { Context } from '../../src/llm/types/context.js';

function model(id: string): Model {
  return {
    id, provider: 'p', api: 'ai-sdk', sdk: 'openai', reasoning: false,
    input: ['text'], contextWindow: 8_000, maxTokens: 1_000,
  } as Model;
}

function reply(text: string, extra: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    role: 'assistant', content: [{ type: 'text', text }], api: 'ai-sdk', provider: 'p', model: 'm',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 } as AssistantMessage['usage'],
    stopReason: 'stop', timestamp: 0, ...extra,
  };
}

function apiError(statusCode: number, headers: Record<string, string> = {}, message = `HTTP ${statusCode}`) {
  return Object.assign(new Error(message), { name: 'AI_APICallError', statusCode, responseHeaders: headers });
}

type Step = AssistantMessage | Error | ((signal?: AbortSignal) => Promise<AssistantMessage>);

/** Scripted provider: each call consumes the next step, recording which model was asked. */
function scripted(steps: Step[]) {
  const calls: Array<{ model: string; maxRetries?: number }> = [];
  const port: LlmCompletionPort = {
    async complete(m, _ctx, options) {
      calls.push({ model: m.id, maxRetries: options?.maxRetries });
      const step = steps.shift();
      if (!step) throw new Error('script exhausted');
      if (step instanceof Error) throw step;
      if (typeof step === 'function') return step(options?.signal);
      return step;
    },
    async completeSimple(m, ctx, options) {
      return this.complete(m, ctx, options);
    },
  };
  return { port, calls };
}

const ctx = { systemPrompt: '', messages: [] } as unknown as Context;
const noSleep = vi.fn(async () => {});

function harness(steps: Step[], config = {}, fallbacks: string[] = []) {
  const { port, calls } = scripted(steps);
  const events: ProviderResilienceEvent[] = [];
  const resilient = createResilientCompletionPort(port, {
    config,
    fallbackModels: fallbacks.map(model),
    onEvent: (e) => events.push(e),
    sleep: noSleep,
    random: () => 0.5,
  });
  return { resilient, calls, events };
}

describe('classifyProviderError', () => {
  it('classifies HTTP status codes', () => {
    expect(classifyProviderError(apiError(429)).kind).toBe('rate_limit');
    expect(classifyProviderError(apiError(503))).toMatchObject({ kind: 'server', retryable: true });
    expect(classifyProviderError(apiError(401))).toMatchObject({ kind: 'auth', retryable: false, fallbackEligible: false });
    expect(classifyProviderError(apiError(400))).toMatchObject({ kind: 'bad_request', retryable: false, fallbackEligible: true });
  });

  it('unwraps AI SDK RetryError and reads Retry-After', () => {
    const wrapped = Object.assign(new Error('retries failed'), {
      name: 'AI_RetryError',
      lastError: apiError(429, { 'Retry-After': '3' }),
    });
    expect(classifyProviderError(wrapped)).toMatchObject({ kind: 'rate_limit', retryAfterMs: 3_000 });
  });

  it('treats context overflow and caller aborts as non-retryable', () => {
    expect(classifyProviderError(apiError(400, {}, 'maximum context length exceeded')).kind).toBe('context_overflow');
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    expect(classifyProviderError(abort)).toMatchObject({ kind: 'aborted', retryable: false });
  });

  it('recognises network error codes', () => {
    const err = Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNRESET' } });
    expect(classifyProviderError(err).kind).toBe('network');
  });
});

describe('backoff helpers', () => {
  it('doubles with jitter and caps at maxDelayMs', () => {
    const cfg = { baseDelayMs: 1_000, maxDelayMs: 4_000 };
    expect(computeBackoffDelay(0, cfg, undefined, () => 0)).toBe(500);
    expect(computeBackoffDelay(1, cfg, undefined, () => 1)).toBe(2_000);
    expect(computeBackoffDelay(5, cfg, undefined, () => 1)).toBe(4_000);
    expect(computeBackoffDelay(0, cfg, 7_000)).toBe(7_000);
  });

  it('parses Retry-After seconds and HTTP dates', () => {
    expect(parseRetryAfterMs('2')).toBe(2_000);
    expect(parseRetryAfterMs(new Date(10_000).toUTCString(), 4_000)).toBe(6_000);
    expect(parseRetryAfterMs('soon')).toBeUndefined();
  });

  it('documents conservative defaults and ignores invalid overrides', () => {
    expect(resolveProviderResilienceConfig()).toEqual({
      maxRetries: 2, baseDelayMs: 1_000, maxDelayMs: 10_000, maxRetryAfterMs: 30_000,
      requestTimeoutMs: 180_000, emptyReplyRetries: 0, fallback: true,
    });
    expect(resolveProviderResilienceConfig({ maxRetries: -1 }, { maxRetries: 1 }).maxRetries).toBe(1);
  });
});

describe('createResilientCompletionPort (fault injection)', () => {
  it('retries a 429 with backoff, then succeeds, and disables SDK-level retries', async () => {
    const { resilient, calls, events } = harness([apiError(429), reply('ok')]);
    await expect(resilient.complete(model('a'), ctx)).resolves.toMatchObject({ content: [{ text: 'ok' }] });
    expect(calls).toEqual([{ model: 'a', maxRetries: 0 }, { model: 'a', maxRetries: 0 }]);
    expect(events).toEqual([expect.objectContaining({ type: 'retry', kind: 'rate_limit', delayMs: 750 })]);
  });

  it('falls back to the next candidate once retries are exhausted', async () => {
    const { resilient, calls, events } = harness(
      [apiError(503), apiError(503), reply('from b')],
      { maxRetries: 1 },
      ['b'],
    );
    await expect(resilient.complete(model('a'), ctx)).resolves.toMatchObject({ content: [{ text: 'from b' }] });
    expect(calls.map((c) => c.model)).toEqual(['a', 'a', 'b']);
    expect(events.map((e) => e.type)).toEqual(['retry', 'fallback']);
  });

  it('skips retry and falls back when Retry-After exceeds the cap', async () => {
    const { resilient, calls } = harness([apiError(429, { 'retry-after': '120' }), reply('b')], {}, ['b']);
    await resilient.complete(model('a'), ctx);
    expect(calls.map((c) => c.model)).toEqual(['a', 'b']);
  });

  it('times out a hung attempt and retries it', async () => {
    const hang: Step = (signal) => new Promise((_, reject) => {
      signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
    const { resilient, events } = harness([hang, reply('ok')], { requestTimeoutMs: 20 });
    await expect(resilient.complete(model('a'), ctx)).resolves.toMatchObject({ content: [{ text: 'ok' }] });
    expect(events[0]).toMatchObject({ type: 'retry', kind: 'timeout' });
  });

  it('throws a user-friendly ProviderRequestError when everything fails', async () => {
    const { resilient, events } = harness([apiError(429), apiError(429)], { maxRetries: 1 });
    const error = await resilient.complete(model('a'), ctx).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderRequestError);
    expect(error).toMatchObject({ kind: 'rate_limit', attempts: 2 });
    expect((error as Error).message).toContain('限流');
    expect(events.at(-1)).toMatchObject({ type: 'give_up' });
  });

  it('rethrows non-retryable errors unchanged so upstream handlers still see them', async () => {
    const overflow = apiError(400, {}, 'maximum context length exceeded');
    const { resilient, calls } = harness([overflow], {}, ['b']);
    await expect(resilient.complete(model('a'), ctx)).rejects.toBe(overflow);
    expect(calls).toHaveLength(1);
  });

  it('passes empty replies through by default', async () => {
    const empty = reply('');
    const { resilient, calls } = harness([empty], {}, ['b']);
    await expect(resilient.complete(model('a'), ctx)).resolves.toBe(empty);
    expect(calls).toHaveLength(1);
  });

  it('re-asks after an empty reply when the quirk preset opts in', async () => {
    const { resilient, calls, events } = harness([reply('  '), reply('answer')], { emptyReplyRetries: 1 });
    await expect(resilient.complete(model('a'), ctx)).resolves.toMatchObject({ content: [{ text: 'answer' }] });
    expect(calls).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: 'retry', kind: 'empty_response', delayMs: 0 });
  });

  it('re-asks after a malformed (nameless) tool call when opted in', async () => {
    const malformed = reply('', { content: [{ type: 'toolCall', id: 't1', name: '', arguments: {} }] as AssistantMessage['content'] });
    const { resilient, events } = harness([malformed, reply('fixed')], { emptyReplyRetries: 1 });
    await expect(resilient.complete(model('a'), ctx)).resolves.toMatchObject({ content: [{ text: 'fixed' }] });
    expect(events[0]).toMatchObject({ kind: 'malformed_tool_call' });
  });

  it('does not retry once the caller aborts', async () => {
    const controller = new AbortController();
    const abortingStep: Step = async () => {
      controller.abort();
      throw apiError(503);
    };
    const { resilient, calls } = harness([abortingStep, reply('never')]);
    await expect(resilient.complete(model('a'), ctx, { signal: controller.signal })).rejects.toThrow('HTTP 503');
    expect(calls).toHaveLength(1);
  });

  it('respects fallback: false', async () => {
    const { resilient, calls } = harness([apiError(500)], { maxRetries: 0, fallback: false }, ['b']);
    await expect(resilient.complete(model('a'), ctx)).rejects.toBeInstanceOf(ProviderRequestError);
    expect(calls.map((c) => c.model)).toEqual(['a']);
  });
});

describe('isProviderFailureMessage', () => {
  it('recognises only the curated user-facing texts', async () => {
    const { isProviderFailureMessage, describeProviderFailure } = await import('../../src/llm/provider-resilience.js');
    expect(isProviderFailureMessage(describeProviderFailure('timeout'))).toBe(true);
    expect(isProviderFailureMessage('HTTP 500 internal error')).toBe(false);
  });
});
