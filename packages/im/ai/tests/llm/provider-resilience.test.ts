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

function harness(steps: Step[], config = {}) {
  const { port, calls } = scripted(steps);
  const events: ProviderResilienceEvent[] = [];
  const resilient = createResilientCompletionPort(port, {
    config,
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
    expect(classifyProviderError(apiError(401))).toMatchObject({ kind: 'auth', retryable: false });
    expect(classifyProviderError(apiError(400))).toMatchObject({ kind: 'bad_request', retryable: false });
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
      requestTimeoutMs: 120_000, firstResponseTimeoutMs: 30_000, emptyReplyRetries: 0,
    });
    expect(resolveProviderResilienceConfig({ maxRetries: -1 }, { maxRetries: 1 }).maxRetries).toBe(1);
  });
});

describe('createResilientCompletionPort (fault injection)', () => {
  it('keeps retries independent of a throwing event observer', async () => {
    const result = reply('ok');
    const { port, calls } = scripted([apiError(429), result]);
    const resilient = createResilientCompletionPort(port, { config: { maxRetries: 1, requestTimeoutMs: 0 }, sleep: noSleep,
      onEvent: () => { throw new Error('diagnostic unavailable'); } });
    await expect(resilient.complete(model('a'), ctx)).resolves.toBe(result);
    expect(calls.map(call => call.model)).toEqual(['a', 'a']);
  });

  it('retries a 429 with backoff, then succeeds, and disables SDK-level retries', async () => {
    const { resilient, calls, events } = harness([apiError(429), reply('ok')]);
    await expect(resilient.complete(model('a'), ctx)).resolves.toMatchObject({ content: [{ text: 'ok' }] });
    expect(calls).toEqual([{ model: 'a', maxRetries: 0 }, { model: 'a', maxRetries: 0 }]);
    expect(events).toEqual([expect.objectContaining({ type: 'retry', kind: 'rate_limit', delayMs: 750 })]);
  });

  it('stops on the selected model when its retries are exhausted', async () => {
    const { resilient, calls, events } = harness([apiError(503), apiError(503), reply('unused')], { maxRetries: 1 });
    await expect(resilient.complete(model('a'), ctx)).rejects.toMatchObject({ kind: 'server', attempts: 2 });
    expect(calls.map(call => call.model)).toEqual(['a', 'a']);
    expect(events.map(event => event.type)).toEqual(['retry', 'give_up']);
  });

  it('does not wait or choose a different model when Retry-After exceeds the cap', async () => {
    const { resilient, calls } = harness([apiError(429, { 'retry-after': '120' }), reply('unused')]);
    await expect(resilient.complete(model('a'), ctx)).rejects.toMatchObject({ kind: 'rate_limit', attempts: 1 });
    expect(calls.map(call => call.model)).toEqual(['a']);
  });

  it('times out a hung attempt and retries it', async () => {
    const hang: Step = (signal) => new Promise((_, reject) => {
      signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
    const { resilient, events } = harness([hang, reply('ok')], { requestTimeoutMs: 20 });
    await expect(resilient.complete(model('a'), ctx)).resolves.toMatchObject({ content: [{ text: 'ok' }] });
    expect(events[0]).toMatchObject({ type: 'timeout', phase: 'request', timeoutMs: 20 });
    expect(events[1]).toMatchObject({ type: 'retry', kind: 'timeout' });
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
    const { resilient, calls } = harness([overflow], {});
    await expect(resilient.complete(model('a'), ctx)).rejects.toBe(overflow);
    expect(calls).toHaveLength(1);
  });

  it('passes empty replies through by default', async () => {
    const empty = reply('');
    const { resilient, calls } = harness([empty], {});
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

  it('never switches away from the selected model', async () => {
    const { resilient, calls } = harness([apiError(500)], { maxRetries: 0 });
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

describe('injected timers', () => {
  it('arms the per-attempt timeout on the injected timers, not the real clock', async () => {
    const pending: Array<() => void> = [];
    const timers = {
      setTimeout: (fn: () => void) => { pending.push(fn); return pending.length; },
      clearTimeout: () => {},
    };
    let calls = 0;
    const port: LlmCompletionPort = {
      complete: (_m, _c, options) => {
        calls += 1;
        if (calls > 1) return Promise.resolve(reply('ok'));
        return new Promise((_, reject) => {
          options?.signal?.addEventListener('abort', () => reject(options.signal?.reason));
          queueMicrotask(() => pending.shift()?.());
        });
      },
      completeSimple: () => Promise.reject(new Error('unused')),
    };
    const events: ProviderResilienceEvent[] = [];
    const resilient = createResilientCompletionPort(port, {
      config: { requestTimeoutMs: 60_000 }, timers, sleep: noSleep, random: () => 0.5, onEvent: (e) => events.push(e),
    });
    await expect(resilient.complete(model('a'), ctx)).resolves.toMatchObject({ content: [{ text: 'ok' }] });
    expect(events).toEqual([
      expect.objectContaining({ type: 'timeout', phase: 'request', timeoutMs: 60_000, attempt: 1 }),
      expect.objectContaining({ type: 'retry', kind: 'timeout' }),
    ]);
  });
});

describe('first-response deadline (#1250 model-request-hangs-no-timeout)', () => {
  /** A provider that never answers: it only settles when its signal aborts. */
  function silentProvider(onCall?: (options: Parameters<LlmCompletionPort['complete']>[2]) => void) {
    const calls: number[] = [];
    const complete: LlmCompletionPort['complete'] = (_m, _c, options) => {
      calls.push(calls.length + 1);
      onCall?.(options);
      return new Promise((_, reject) => {
        options?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
    };
    return { port: { complete, completeSimple: complete } satisfies LlmCompletionPort, calls };
  }

  it('fails a silent provider after 30s by default as no_response, without re-asking the same model', async () => {
    vi.useFakeTimers();
    try {
      const { port, calls } = silentProvider();
      const events: ProviderResilienceEvent[] = [];
      const resilient = createResilientCompletionPort(port, { sleep: noSleep, onEvent: e => events.push(e) });
      const result = resilient.complete(model('relay-model'), ctx).catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(29_999);
      expect(events).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      const error = await result;
      expect(error).toBeInstanceOf(ProviderRequestError);
      expect(error).toMatchObject({ kind: 'no_response', attempts: 1 });
      expect((error as Error).message).toContain('模型服务无响应');
      expect(calls).toHaveLength(1);
      expect(events).toEqual([
        { type: 'timeout', model: 'relay-model', attempt: 1, phase: 'first_response', timeoutMs: 30_000 },
        expect.objectContaining({ type: 'give_up', kind: 'no_response' }),
      ]);
    } finally { vi.useRealTimers(); }
  });

  it('stops the first-response timer once the transport reports a response; the 120s total deadline still applies', async () => {
    vi.useFakeTimers();
    try {
      const started = vi.fn();
      const { port, calls } = silentProvider(options => { options?.onResponseStart?.(); });
      const events: ProviderResilienceEvent[] = [];
      const resilient = createResilientCompletionPort(port, { config: { maxRetries: 0 }, sleep: noSleep, onEvent: e => events.push(e) });
      const result = resilient.complete(model('a'), ctx, { onResponseStart: started }).catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(events).toEqual([]);
      expect(started).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(await result).toMatchObject({ kind: 'timeout', attempts: 1 });
      expect(calls).toHaveLength(1);
      expect(events[0]).toEqual({ type: 'timeout', model: 'a', attempt: 1, phase: 'request', timeoutMs: 120_000 });
    } finally { vi.useRealTimers(); }
  });

  it('counts streamed text as a response and keeps onTextDelta absent when the caller did not stream', async () => {
    vi.useFakeTimers();
    try {
      const seen: Array<boolean> = [];
      const complete: LlmCompletionPort['complete'] = async (_m, _c, options) => {
        seen.push(options?.onTextDelta !== undefined);
        if (options?.onTextDelta) {
          await new Promise(resolve => setTimeout(resolve, 10_000));
          options.onTextDelta('hi');
          await new Promise(resolve => setTimeout(resolve, 40_000));
        }
        return reply('hi');
      };
      const resilient = createResilientCompletionPort({ complete, completeSimple: complete }, { sleep: noSleep });
      const streamed = resilient.complete(model('a'), ctx, { onTextDelta: () => {} });
      await vi.advanceTimersByTimeAsync(50_000);
      await expect(streamed).resolves.toMatchObject({ content: [{ text: 'hi' }] });
      await expect(resilient.complete(model('a'), ctx)).resolves.toMatchObject({ content: [{ text: 'hi' }] });
      expect(seen).toEqual([true, false]);
    } finally { vi.useRealTimers(); }
  });

  it('firstResponseTimeoutMs: 0 disables the first-response deadline', async () => {
    vi.useFakeTimers();
    try {
      const { port } = silentProvider();
      const events: ProviderResilienceEvent[] = [];
      const resilient = createResilientCompletionPort(port, {
        config: { firstResponseTimeoutMs: 0, requestTimeoutMs: 50_000, maxRetries: 0 }, sleep: noSleep, onEvent: e => events.push(e) });
      const result = resilient.complete(model('a'), ctx).catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(50_000);
      expect(await result).toMatchObject({ kind: 'timeout' });
      expect(events[0]).toMatchObject({ phase: 'request' });
    } finally { vi.useRealTimers(); }
  });

  it('classifies the first-response error as non-retryable no_response', async () => {
    const { FirstResponseTimeoutError } = await import('../../src/llm/provider-resilience.js');
    expect(classifyProviderError(new FirstResponseTimeoutError(30_000))).toEqual({ kind: 'no_response', retryable: false });
  });
});

it.each([Number.NaN, -1, 2_147_483_648])('rejects invalid explicit timeout %s before submitting a request', async requestTimeoutMs => {
  const complete = vi.fn<LlmCompletionPort['complete']>();
  const port = createResilientCompletionPort({ complete, completeSimple: complete });
  await expect(port.complete(model('selected'), ctx, { requestTimeoutMs })).rejects.toThrow('Invalid requestTimeoutMs');
  expect(complete).not.toHaveBeenCalled();
});
