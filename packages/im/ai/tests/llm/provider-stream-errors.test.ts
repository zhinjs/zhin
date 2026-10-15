/**
 * Mid-stream provider errors, finish reasons and tool-call parsing over the real
 * AI SDK transports with a mocked HTTP endpoint (no network). The shared mocked-HTTP
 * harness from #784 is not on main yet, so this file keeps a small local server.
 */
import { describe, expect, it } from 'vitest';
import { createLlmApiRuntime } from '../../src/llm/llm-runtime-factory.js';
import { createLlmTransportModel } from '../../src/llm/llm-api-runtime.js';
import { createUserMessage } from '../../src/llm/types/agent-message.js';
import type { ProviderInstanceConfig } from '../../src/llm/types/model.js';
import {
  classifyProviderError,
  createResilientCompletionPort,
  type ProviderResilienceEvent,
} from '../../src/llm/provider-resilience.js';
import { ProviderStreamError, streamPartError } from '../../src/llm/bridge/stream-error.js';
import { finishFailureKind, resolveFinish } from '../../src/llm/bridge/finish-reason.js';
import { ProviderRequestError, describeProviderFailure, isProviderFailureMessage } from '../../src/llm/provider-resilience.js';

/** One scripted HTTP answer: SSE chunks, or a JSON error body with a status. */
type Answer =
  | { chunks: unknown[] }
  | { status: number; body: unknown; headers?: Record<string, string> };

function respond(answer: Answer): Response {
  if ('chunks' in answer) {
    const text = answer.chunks.map((chunk) => `data: ${typeof chunk === 'string' ? chunk : JSON.stringify(chunk)}\n\n`).join('');
    return new Response(text, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }
  return new Response(JSON.stringify(answer.body), {
    status: answer.status,
    headers: { 'content-type': 'application/json', ...answer.headers },
  });
}

function setup(sdk: ProviderInstanceConfig['sdk'], answers: Answer[], models = ['primary', 'secondary'], extra: Partial<ProviderInstanceConfig> = {}) {
  const requests: Array<Record<string, any>> = [];
  const fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body ?? '{}')));
    const answer = answers[Math.min(requests.length - 1, answers.length - 1)]!;
    return respond(answer);
  }) as typeof globalThis.fetch;
  const config: ProviderInstanceConfig = { sdk, apiKey: 'test-key', baseUrl: 'https://llm.test/v1', ...extra };
  const runtime = createLlmApiRuntime([{ alias: 'p', config, models, fetch }], () => models);
  const [primary, ...rest] = models.map((id) => createLlmTransportModel('p', config, id));
  return { runtime, model: primary!, fallbacks: rest, requests };
}

const ask = { systemPrompt: '', messages: [createUserMessage('hi')] };

const noSleep = async () => {};

function resilient(runtime: ReturnType<typeof setup>['runtime'], fallbackModels: ReturnType<typeof setup>['fallbacks'] = [], config = {}) {
  const events: ProviderResilienceEvent[] = [];
  const port = createResilientCompletionPort(runtime, {
    fallbackModels, sleep: noSleep, random: () => 0, onEvent: (e) => events.push(e), config: { requestTimeoutMs: 0, ...config },
  });
  return { port, events };
}

// --- SSE fixtures -------------------------------------------------------------

const anthropicStart = { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', content: [], model: 'primary', stop_reason: null, usage: { input_tokens: 5, output_tokens: 0 } } };
function anthropicText(text: string): unknown[] {
  return [
    anthropicStart,
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } },
    { type: 'message_stop' },
  ];
}

function chatChunk(delta: Record<string, unknown>, finish: string | null = null) {
  return { id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'primary', choices: [{ index: 0, delta, finish_reason: finish }] };
}
function chatText(text: string): unknown[] {
  return [chatChunk({ role: 'assistant', content: text }), chatChunk({}, 'stop'), '[DONE]'];
}

describe('streamPartError', () => {
  it('keeps message, type and code of plain-object error parts instead of "[object Object]"', () => {
    const err = streamPartError({ type: 'overloaded_error', message: 'Overloaded' });
    expect(err).toBeInstanceOf(ProviderStreamError);
    expect(err.message).toBe('Overloaded');
    expect(err).toMatchObject({ type: 'overloaded_error', statusCode: 529, data: { error: { type: 'overloaded_error' } } });
    expect(String(err)).not.toContain('[object Object]');
  });

  it('infers an HTTP-equivalent status from Anthropic, OpenAI and Google error shapes', () => {
    expect(streamPartError({ type: 'rate_limit_error', message: 'slow down' })).toMatchObject({ statusCode: 429 });
    expect(streamPartError({ message: 'The server had an error', type: 'server_error', code: null })).toMatchObject({ statusCode: 500 });
    // Responses API: the event type is "error"; the cause is in `code`.
    expect(streamPartError({ type: 'error', code: 'rate_limit_exceeded', message: 'Rate limit reached' })).toMatchObject({ statusCode: 429, code: 'rate_limit_exceeded' });
    expect(streamPartError({ code: 503, message: 'The model is overloaded.', status: 'UNAVAILABLE' })).toMatchObject({ statusCode: 503 });
    expect(streamPartError({ error: { message: 'upstream', type: 'server_error' } })).toMatchObject({ message: 'upstream', statusCode: 500 });
    expect(streamPartError({ message: 'something odd' }).statusCode).toBeUndefined();
  });

  it('keeps string parts (DeepSeek) and Errors as they are', () => {
    expect(streamPartError('Insufficient system resource').message).toBe('Insufficient system resource');
    const original = new TypeError('boom');
    expect(streamPartError(original)).toBe(original);
    expect(streamPartError({ foo: 1 }).message).toBe('{"foo":1}');
  });

  it('classifies a converted overload / rate limit as retryable and fallback-eligible', () => {
    expect(classifyProviderError(streamPartError({ type: 'overloaded_error', message: 'Overloaded' }))).toMatchObject({ kind: 'server', retryable: true, fallbackEligible: true });
    expect(classifyProviderError(streamPartError({ type: 'rate_limit_error', message: 'Too many' }))).toMatchObject({ kind: 'rate_limit', retryable: true });
    expect(classifyProviderError(streamPartError({ code: 503, message: 'x', status: 'UNAVAILABLE' }))).toMatchObject({ kind: 'server', retryable: true });
  });
});

describe('mid-stream errors over real transports', () => {
  it('retries an Anthropic overloaded_error that arrives inside a 200 stream', async () => {
    const { runtime, model } = setup('anthropic', [
      { chunks: [anthropicStart, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }] },
      { chunks: anthropicText('你好') },
    ]);
    const { port, events } = resilient(runtime);
    const reply = await port.complete(model, ask);
    expect(reply.content).toEqual([expect.objectContaining({ type: 'text', text: '你好' })]);
    expect(events).toEqual([expect.objectContaining({ type: 'retry', kind: 'server', error: 'Overloaded' })]);
  });

  it('falls back after an OpenAI server_error chunk keeps failing on the primary', async () => {
    const failing: Answer = { chunks: [chatChunk({ role: 'assistant', content: '' }), { error: { message: 'The server had an error while processing your request.', type: 'server_error', param: null, code: null } }] };
    const { runtime, model, fallbacks, requests } = setup('openai', [failing, failing, { chunks: chatText('ok') }]);
    const { port, events } = resilient(runtime, fallbacks, { maxRetries: 1 });
    const reply = await port.complete(model, ask);
    expect(reply.content).toEqual([expect.objectContaining({ text: 'ok' })]);
    expect(requests.map((r) => r.model)).toEqual(['primary', 'primary', 'secondary']);
    expect(events.map((e) => e.type)).toEqual(['retry', 'fallback']);
    expect(events[0]).toMatchObject({ kind: 'server', error: expect.stringContaining('The server had an error') });
  });
});

describe('provider-side error finishes (DeepSeek insufficient_system_resource)', () => {
  const finish = (rawFinishReason: string | undefined) => resolveFinish({ finishReason: 'error', rawFinishReason, hasText: false, hasToolCalls: false });

  it('reports only Gemini tool-call parse failures as malformed tool calls', () => {
    expect(finishFailureKind(finish('MALFORMED_FUNCTION_CALL').errorMessage)).toBe('malformed_tool_call');
    expect(finishFailureKind(finish('insufficient_system_resource').errorMessage)).toBe('provider_error');
    expect(finishFailureKind(finish(undefined).errorMessage)).toBe('provider_error');
    expect(isProviderFailureMessage(finish('insufficient_system_resource').errorMessage!)).toBe(true);
  });

  const exhausted = { chunks: [chatChunk({ role: 'assistant', content: '' }), chatChunk({}, 'insufficient_system_resource'), '[DONE]'] };

  it('retries the request with backoff instead of reporting a malformed tool call', async () => {
    const { runtime, model, requests } = setup('deepseek', [exhausted, { chunks: chatText('好的') }]);
    const { port, events } = resilient(runtime);
    const reply = await port.complete(model, ask);
    expect(reply.content).toEqual([expect.objectContaining({ text: '好的' })]);
    expect(requests).toHaveLength(2);
    expect(events).toEqual([expect.objectContaining({ type: 'retry', kind: 'server', error: expect.stringContaining('insufficient_system_resource') })]);
  });

  it('gives the user the polite outage text once retries are exhausted', async () => {
    const { runtime, model } = setup('deepseek', [exhausted]);
    const { port, events } = resilient(runtime, [], { maxRetries: 1 });
    const failure = await port.complete(model, ask).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ProviderRequestError);
    expect((failure as Error).message).toBe(describeProviderFailure('server'));
    expect(events.map((e) => e.type)).toEqual(['retry', 'give_up']);
  });
});
