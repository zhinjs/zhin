import { SyntheticCompletionRuntime } from '../helpers/synthetic-completion-runtime.js';
import { describe, expect, it, vi } from 'vitest';
import { createAssistantMessageEventStream, type AssistantStreamEvent } from '../../src/llm/llm-api-runtime.js';
import { EMPTY_TOKEN_USAGE, type AssistantMessage } from '../../src/llm/types/agent-message.js';
import type { Model } from '../../src/llm/types/model.js';
import { createResilientCompletionPort, ProviderRequestError, type ProviderResilienceEvent } from '../../src/llm/provider-resilience.js';

const model: Model = { id: 'test', provider: 'test', api: 'ai-sdk', sdk: 'openai', reasoning: false,
  input: ['text'], contextWindow: 8192, maxTokens: 1000 };
const message: AssistantMessage = { role: 'assistant', api: 'ai-sdk', provider: 'test', model: 'test',
  content: [{ type: 'text', text: 'first second' }], usage: EMPTY_TOKEN_USAGE, timestamp: 0, stopReason: 'stop' };

describe('completion deltas', () => {
  it.each(['complete', 'completeSimple'] as const)('cancels the %s provider when its functional delta consumer fails', async method => {
    const runtime = new SyntheticCompletionRuntime(), original = new Error('reply delivery stopped');
    const caller = new AbortController();
    let providerSignal: AbortSignal | undefined, producerStopped = false;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    runtime.registerApiProvider({ api: 'ai-sdk', stream: (_model, _context, options) => {
      providerSignal = options?.signal;
      return createAssistantMessageEventStream(async push => {
        push({ type: 'text_delta', text: 'first' });
        await Promise.race([gate, new Promise<void>(resolve => providerSignal?.addEventListener('abort', () => resolve(), { once: true }))]);
        producerStopped = providerSignal?.aborted === true;
        return message;
      });
    } });
    try {
      await expect(runtime[method](model, { systemPrompt: '', messages: [] }, { signal: caller.signal,
        onTextDelta: () => { throw original; } })).rejects.toBe(original);
      expect(providerSignal?.aborted).toBe(true);
      expect(providerSignal?.reason).toBe(original);
      expect(caller.signal.aborted).toBe(false);
      await vi.waitFor(() => expect(producerStopped).toBe(true));
    } finally { release(); }
  });

  it.each([{ code: 402, kind: 'billing' }, { code: 429, kind: 'quota_exhausted' }] as const)(
    'keeps $kind classification after publication without retrying or falling back', async ({ code, kind }) => {
      const error = Object.assign(new Error(code === 402 ? 'Insufficient Balance' : 'Rate limit reached on requests per day (RPD)'), { statusCode: code });
      const complete = vi.fn(async () => { throw error; });
      const events: ProviderResilienceEvent[] = [];
      const port = createResilientCompletionPort({ complete, completeSimple: complete }, {
        config: { maxRetries: 2, requestTimeoutMs: 0 },
        onEvent: event => { events.push(event); },
      });
      const rejected = await port.complete(model, { systemPrompt: '', messages: [] }, { retryAllowed: () => false }).catch(error => error);
      expect(rejected).toBeInstanceOf(ProviderRequestError);
      expect(rejected).toMatchObject({ kind, cause: error });
      expect(complete).toHaveBeenCalledOnce();
      expect(events).toEqual([{ type: 'give_up', model: model.id, kind, error: error.message }]);
    });

  it('keeps the published quota failure when its give-up observer throws', async () => {
    const error = Object.assign(new Error('Insufficient Balance'), { statusCode: 402 });
    const complete = vi.fn(async () => { throw error; });
    const port = createResilientCompletionPort({ complete, completeSimple: complete }, {
      config: { maxRetries: 2, requestTimeoutMs: 0 },
      onEvent: () => { throw new Error('logger unavailable'); },
    });
    const rejected = await port.complete(model, { systemPrompt: '', messages: [] }, { retryAllowed: () => false }).catch(error => error);
    expect(rejected).toBeInstanceOf(ProviderRequestError);
    expect(rejected).toMatchObject({ kind: 'billing', cause: error });
    expect(complete).toHaveBeenCalledOnce();
  });
  it('observes genuine provider deltas before the completion has resolved', async () => {
    const runtime = new SyntheticCompletionRuntime();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    runtime.registerApiProvider({ api: 'ai-sdk', stream: () => ({
      subscribe: () => () => {},
      async *[Symbol.asyncIterator](): AsyncGenerator<AssistantStreamEvent> {
        yield { type: 'text_delta', text: 'first' };
        await gate;
        yield { type: 'text_delta', text: ' second' };
        yield { type: 'done', message };
      },
    }) });
    const chunks: string[] = [];
    const result = runtime.complete(model, { systemPrompt: '', messages: [] }, { onTextDelta: value => chunks.push(value) });
    await vi.waitFor(() => expect(chunks).toEqual(['first']));
    release();
    expect(await result).toBe(message);
    expect(chunks).toEqual(['first', ' second']);
  });

  it('does not regenerate a request after its owner has committed partial output', async () => {
    const failed = Object.assign(new Error('HTTP 503'), { statusCode: 503 });
    let committed = false;
    const complete = vi.fn(async () => { committed = true; throw failed; });
    const port = createResilientCompletionPort({ complete, completeSimple: complete }, {
      config: { maxRetries: 2, requestTimeoutMs: 0 }, sleep: async () => {},
    });
    await expect(port.complete(model, { systemPrompt: '', messages: [] }, { retryAllowed: () => !committed })).rejects.toBe(failed);
    expect(complete).toHaveBeenCalledTimes(1);
  });
});

describe('ADR 0047 S2/D3 partial-stream auth does not replay', () => {
  const context = { systemPrompt: '', messages: [] };
  const authError = (code: 401 | 403) => Object.assign(new Error(`HTTP ${code} Unauthorized`), { statusCode: code });

  it.each([401, 403] as const)('a %s after partial reply is offered surfaces once without regenerating the call', async code => {
    const runtime = new SyntheticCompletionRuntime(), failure = authError(code);
    let streams = 0;
    runtime.registerApiProvider({ api: 'ai-sdk', stream: () => {
      streams++;
      return createAssistantMessageEventStream(async push => {
        push({ type: 'text_delta', text: 'partial' });
        throw failure;
      });
    } });
    let offered = false;
    const chunks: string[] = [], events: ProviderResilienceEvent[] = [];
    const port = createResilientCompletionPort(runtime, {
      config: { maxRetries: 3, requestTimeoutMs: 0 }, sleep: async () => {}, onEvent: event => { events.push(event); },
    });
    const rejected = await port.complete(model, context, {
      onTextDelta: value => { offered = true; chunks.push(value); },
      retryAllowed: () => !offered,
    }).catch(error => error);
    expect(streams).toBe(1);
    expect(chunks).toEqual(['partial']);
    expect(rejected).not.toBeInstanceOf(ProviderRequestError);
    expect(rejected?.message ?? String(rejected)).toContain(String(code));
    expect(events.filter(event => event.type === 'retry')).toEqual([]);
  });

  it('a late 401 after tools already ran is not retried even with retry budget left', async () => {
    const toolRuns = vi.fn();
    let toolsRan = false;
    const complete = vi.fn(async () => { toolRuns(); toolsRan = true; throw authError(401); });
    const port = createResilientCompletionPort({ complete, completeSimple: complete }, {
      config: { maxRetries: 5, requestTimeoutMs: 0 }, sleep: async () => {},
    });
    await expect(port.completeSimple(model, context, { retryAllowed: () => !toolsRan })).rejects.toMatchObject({ statusCode: 401 });
    expect(complete).toHaveBeenCalledOnce();
    expect(toolRuns).toHaveBeenCalledOnce();
  });

  it('auth stays non-retryable at the request level even before anything is offered', async () => {
    const failure = authError(401);
    const complete = vi.fn(async () => { throw failure; });
    const events: ProviderResilienceEvent[] = [];
    const port = createResilientCompletionPort({ complete, completeSimple: complete }, {
      config: { maxRetries: 3, requestTimeoutMs: 0 }, sleep: async () => {}, onEvent: event => { events.push(event); },
    });
    const rejected = await port.complete(model, context, { retryAllowed: () => true }).catch(error => error);
    expect(complete).toHaveBeenCalledOnce();
    expect(rejected).toBe(failure);
    expect(events.filter(event => event.type === 'retry')).toEqual([]);
  });

  it('a transient failure before any offer still gets request-level retry (control)', async () => {
    const complete = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('HTTP 503'), { statusCode: 503 }))
      .mockResolvedValueOnce(message);
    const port = createResilientCompletionPort({ complete, completeSimple: complete }, {
      config: { maxRetries: 2, requestTimeoutMs: 0 }, sleep: async () => {},
    });
    expect(await port.complete(model, context, { retryAllowed: () => true })).toBe(message);
    expect(complete).toHaveBeenCalledTimes(2);
  });
});
