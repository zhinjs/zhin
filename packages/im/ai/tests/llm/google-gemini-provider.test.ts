/**
 * Gemini over the real @ai-sdk/google transport with a mocked HTTP endpoint:
 * image input, function calling, a stable cacheable prefix across turns, and
 * implicit-cache token counts (usageMetadata.cachedContentTokenCount) (#769).
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createLlmApiRuntime } from '../../src/llm/llm-runtime-factory.js';
import { createLlmTransportModel, defaultModelInput } from '../../src/llm/llm-api-runtime.js';
import { createUserMessage, EMPTY_TOKEN_USAGE, type AssistantMessage } from '../../src/llm/types/agent-message.js';
import type { ProviderInstanceConfig } from '../../src/llm/types/model.js';
import {
  ProviderRequestError,
  classifyProviderError,
  createResilientCompletionPort,
  describeProviderFailure,
  isProviderFailureMessage,
  type ProviderResilienceConfig,
  type ProviderResilienceEvent,
  type ProviderTimers,
} from '../../src/llm/provider-resilience.js';
import { finishFailureKind } from '../../src/llm/bridge/finish-reason.js';

const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

type Captured = { url: string; body: Record<string, any> };

function sse(chunks: unknown[]): Response {
  const text = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\r\n\r\n`).join('');
  return new Response(text, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

/** Response marker: never answer; reject only when the request is aborted. `onHang` runs once it is pending. */
const HANG = { __hang: true } as const;

function geminiServer(responses: Array<(body: Record<string, any>) => unknown>, onHang?: () => void) {
  const captured: Captured[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const body = JSON.parse(String(init?.body ?? '{}'));
    captured.push({ url, body });
    const respond = responses[Math.min(captured.length - 1, responses.length - 1)]!;
    const payload = respond(body) as { __chunks?: unknown[]; __status?: number; __hang?: boolean };
    if (payload && payload.__hang) {
      return new Promise<Response>((_, reject) => {
        const signal = init?.signal;
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
        setImmediate(() => onHang?.());
      });
    }
    if (payload && typeof payload.__status === 'number') {
      const { __status, ...error } = payload;
      return new Response(JSON.stringify(error), { status: __status, headers: { 'content-type': 'application/json' } });
    }
    if (payload && Array.isArray(payload.__chunks)) return sse(payload.__chunks);
    return url.includes('streamGenerateContent') ? sse([payload]) : new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof globalThis.fetch;
  return { fetch, captured };
}

const textReply = (text: string, usage: Record<string, number>) => () => ({
  candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }],
  usageMetadata: usage,
});

const PRIMARY = 'gemini-3.8-flash';
const FALLBACK = 'gemini-3.8-flash-lite';

function setup(
  responses: Array<(body: Record<string, any>) => unknown>,
  extra: Partial<ProviderInstanceConfig> = {},
  onHang?: () => void,
) {
  const server = geminiServer(responses, onHang);
  const config: ProviderInstanceConfig = { sdk: 'google', apiKey: 'test-key', ...extra };
  const models = [PRIMARY, FALLBACK];
  const runtime = createLlmApiRuntime([{ alias: 'gemini', config, models, fetch: server.fetch }], () => models);
  const model = createLlmTransportModel('gemini', config, PRIMARY);
  const fallback = createLlmTransportModel('gemini', config, FALLBACK);
  return { runtime, model, fallback, captured: server.captured };
}

const weather = { name: 'get_weather', description: 'Weather for one city.', parameters: z.object({ city: z.string() }) };
const SYSTEM = 'You are zhin, a group-chat assistant. '.repeat(50);

describe('Gemini provider (google sdk)', () => {
  it.each([
    { leading: false, precedingTexts: 1 },
    { leading: false, precedingTexts: 2 },
    { leading: true, precedingTexts: 0 },
    { leading: true, precedingTexts: 2 },
  ])('repairs cross-provider function-call history ($leading, $precedingTexts text turns)', async ({ leading, precedingTexts }) => {
    const { runtime, model, captured } = setup([textReply('ok', { promptTokenCount: 10, candidatesTokenCount: 1, totalTokenCount: 11 })]);
    const call: AssistantMessage = {
      role: 'assistant', api: 'ai-sdk', provider: 'gemini', model: PRIMARY, timestamp: 1,
      usage: { ...EMPTY_TOKEN_USAGE }, stopReason: 'toolCalls', content: [
        { type: 'toolCall', id: 'weather-1', name: 'get_weather', arguments: { city: '上海' }, providerOptions: { google: { thoughtSignature: 'c2ln' } } },
      ],
    };
    const text: AssistantMessage = { ...call, stopReason: 'stop', content: [{ type: 'text', text: '先查天气' }] };
    await runtime.complete(model, {
      systemPrompt: SYSTEM, tools: [weather],
      messages: [
        ...(!leading ? [createUserMessage('天气？')] : []),
        ...Array.from({ length: precedingTexts }, () => text), call,
        { role: 'toolResult', toolCallId: 'weather-1', toolName: 'get_weather', content: [{ type: 'text', text: '晴' }], isError: false, timestamp: 2 },
      ],
    });
    const contents = captured[0]!.body.contents;
    const index = contents.findIndex((c: any) => c.parts.some((p: any) => p.functionCall));
    expect(contents[index - 1]?.role).toBe('user');
    expect(contents[index].parts).toContainEqual(expect.objectContaining({ thoughtSignature: 'c2ln' }));
    expect(contents[index + 1].parts[0]).toMatchObject({ functionResponse: { name: 'get_weather' } });
    expect(contents[index].parts.filter((part: any) => part.text === '先查天气')).toHaveLength(precedingTexts);
  });

  it('defaults Gemini chat models to multimodal input, but not TTS/embedding models or other SDKs', () => {
    expect(defaultModelInput('google', 'gemini-3.8-flash')).toContain('image');
    expect(defaultModelInput('google', 'gemini-3.8-flash-tts')).toEqual(['text']);
    expect(defaultModelInput('google', 'gemini-embedding-001')).toEqual(['text']);
    expect(defaultModelInput('deepseek', 'deepseek-chat')).toEqual(['text']);
    expect(createLlmTransportModel('g', { sdk: 'google', input: ['text'] }, 'gemini-3.8-flash').input).toEqual(['text']);
  });

  it('sends a group-message image as inline data next to the text', async () => {
    const { runtime, model, captured } = setup([textReply('一只猫', { promptTokenCount: 20, candidatesTokenCount: 3, totalTokenCount: 23 })]);
    const message = await runtime.complete(model, {
      systemPrompt: SYSTEM,
      messages: [createUserMessage('图里是什么？', [{ type: 'image', data: { media: { kind: 'base64', value: PNG_1X1, mime_type: 'image/png' } } }])],
    });
    expect(message.stopReason).toBe('stop');
    const parts = captured[0]!.body.contents[0].parts;
    expect(parts).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: '图里是什么？' }),
      expect.objectContaining({ inlineData: expect.objectContaining({ mimeType: 'image/png', data: PNG_1X1 }) }),
    ]));
    expect(JSON.stringify(captured[0]!.body)).not.toContain('test-key');
  });

  it('offers tools as function declarations and parses a function call back', async () => {
    const { runtime, model, captured } = setup([() => ({
      candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'get_weather', args: { city: '上海' } } }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 5, totalTokenCount: 35 },
    })]);
    const message = await runtime.complete(model, { systemPrompt: SYSTEM, messages: [createUserMessage('上海天气？')], tools: [weather] });
    expect(captured[0]!.body.tools[0].functionDeclarations[0]).toMatchObject({ name: 'get_weather' });
    expect(message.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'toolCall', name: 'get_weather', arguments: { city: '上海' } })]));
  });

  it('keeps the cacheable prefix byte-identical across turns and surfaces cached tokens', async () => {
    const { runtime, model, captured } = setup([
      textReply('第一轮', { promptTokenCount: 5000, candidatesTokenCount: 4, totalTokenCount: 5004 }),
      textReply('第二轮', { promptTokenCount: 5100, candidatesTokenCount: 4, totalTokenCount: 5104, cachedContentTokenCount: 4096 }),
    ]);
    const first = await runtime.complete(model, { systemPrompt: SYSTEM, messages: [createUserMessage('你好')], tools: [weather] });
    const second = await runtime.complete(model, {
      systemPrompt: SYSTEM,
      messages: [createUserMessage('你好'), first, createUserMessage('再说一次')],
      tools: [weather],
    });
    const [a, b] = captured.map((c) => c.body);
    expect(JSON.stringify(b!.systemInstruction)).toBe(JSON.stringify(a!.systemInstruction));
    expect(JSON.stringify(b!.tools)).toBe(JSON.stringify(a!.tools));
    // Earlier contents are a strict prefix of the next request's contents.
    expect(JSON.stringify(b!.contents.slice(0, a!.contents.length))).toBe(JSON.stringify(a!.contents));
    expect(first.usage.cacheRead).toBe(0);
    expect(second.usage.cacheRead).toBe(4096);
  });

  it('returns parallel function calls from one chunk and streamed across chunks', async () => {
    const usageMetadata = { promptTokenCount: 30, candidatesTokenCount: 9, totalTokenCount: 39 };
    const { runtime, model } = setup([
      () => ({
        candidates: [{ content: { role: 'model', parts: [
          { functionCall: { name: 'get_weather', args: { city: '上海' } } },
          { functionCall: { name: 'get_weather', args: { city: '北京' } } },
        ] }, finishReason: 'STOP' }],
        usageMetadata,
      }),
      () => ({ __chunks: [
        { candidates: [{ content: { role: 'model', parts: [{ text: '先查' }] } }] },
        { candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'get_weather', args: { city: '广州' } } }] } }] },
        { candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'get_weather', args: { city: '深圳' } } }] }, finishReason: 'STOP' }], usageMetadata },
      ] }),
    ]);
    const cities = (m: { content: Array<{ type: string; arguments?: Record<string, unknown> }> }) =>
      m.content.filter((b) => b.type === 'toolCall').map((b) => b.arguments?.city);
    const one = await runtime.complete(model, { systemPrompt: SYSTEM, messages: [createUserMessage('上海和北京天气？')], tools: [weather] });
    expect(one.stopReason).toBe('toolCalls');
    expect(cities(one)).toEqual(['上海', '北京']);
    const streamed = await runtime.complete(model, { systemPrompt: SYSTEM, messages: [createUserMessage('广州和深圳？')], tools: [weather] });
    expect(cities(streamed)).toEqual(['广州', '深圳']);
    expect(streamed.content).toEqual(expect.arrayContaining([{ type: 'text', text: '先查' }]));
    const ids = streamed.content.filter((b) => b.type === 'toolCall').map((b) => (b as { id: string }).id);
    expect(new Set(ids).size).toBe(2);
  });

  it('round-trips the Gemini 3 function-call thought signature on the next request', async () => {
    const { runtime, model, captured } = setup([
      () => ({
        candidates: [{ content: { role: 'model', parts: [
          { functionCall: { name: 'get_weather', args: { city: '上海' } }, thoughtSignature: 'c2lnLWFiYw==' },
        ] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 5, totalTokenCount: 35 },
      }),
      textReply('上海晴', { promptTokenCount: 40, candidatesTokenCount: 3, totalTokenCount: 43 }),
    ]);
    const call = await runtime.complete(model, { systemPrompt: SYSTEM, messages: [createUserMessage('上海天气？')], tools: [weather] });
    const block = call.content.find((b) => b.type === 'toolCall') as { id: string; providerOptions?: unknown };
    expect(block.providerOptions).toEqual({ google: { thoughtSignature: 'c2lnLWFiYw==' } });
    await runtime.complete(model, {
      systemPrompt: SYSTEM,
      messages: [
        createUserMessage('上海天气？'),
        call,
        { role: 'toolResult', toolCallId: block.id, toolName: 'get_weather', content: [{ type: 'text', text: '晴 25°C' }], isError: false, timestamp: Date.now() },
      ],
      tools: [weather],
    });
    const modelTurn = captured[1]!.body.contents.find((c: { role: string }) => c.role === 'model');
    expect(modelTurn.parts).toEqual([expect.objectContaining({ functionCall: expect.objectContaining({ name: 'get_weather' }), thoughtSignature: 'c2lnLWFiYw==' })]);
  });

  describe('finish reasons', () => {
    const usageMetadata = { promptTokenCount: 10, candidatesTokenCount: 0, totalTokenCount: 10 };
    const finished = (finishReason: string, parts: unknown[] = []) => () => ({
      candidates: [{ content: { role: 'model', parts }, finishReason }],
      usageMetadata,
    });
    const ask = async (respond: () => unknown) => {
      const { runtime, model } = setup([respond]);
      return runtime.complete(model, { systemPrompt: SYSTEM, messages: [createUserMessage('hi')] });
    };

    it.each(['SAFETY', 'RECITATION', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'IMAGE_SAFETY'])('surfaces %s as a polite, visible refusal, not an empty reply', async (reason) => {
      const message = await ask(finished(reason));
      expect(message.stopReason).toBe('error');
      expect(message.errorMessage).toContain(reason);
      expect(message.errorMessage).toMatch(/^抱歉，.*换个说法再试试吧$/);
      expect(finishFailureKind(message.errorMessage)).toBe('safety_block');
      expect(isProviderFailureMessage(message.errorMessage!)).toBe(true);
    });

    it('surfaces a blocked prompt (promptFeedback.blockReason, no candidates)', async () => {
      const message = await ask(() => ({ promptFeedback: { blockReason: 'SAFETY' }, usageMetadata }));
      expect(message.stopReason).toBe('error');
      expect(message.errorMessage).toContain('prompt SAFETY');
      expect(finishFailureKind(message.errorMessage)).toBe('safety_block');
    });

    it('keeps partial text on MAX_TOKENS, but reports a reply that is empty because of it', async () => {
      const partial = await ask(finished('MAX_TOKENS', [{ text: '写到一半' }]));
      expect(partial.stopReason).toBe('length');
      expect(partial.errorMessage).toBeUndefined();
      const empty = await ask(finished('MAX_TOKENS'));
      expect(empty.stopReason).toBe('error');
      expect(empty.errorMessage).toContain('MAX_TOKENS');
    });

    it('reports MALFORMED_FUNCTION_CALL instead of passing an empty reply through', async () => {
      const message = await ask(finished('MALFORMED_FUNCTION_CALL'));
      expect(message.stopReason).toBe('error');
      expect(message.errorMessage).toContain('MALFORMED_FUNCTION_CALL');
    });

    it('leaves a normal STOP alone', async () => {
      const message = await ask(finished('STOP', [{ text: 'ok' }]));
      expect(message.stopReason).toBe('stop');
      expect(message.errorMessage).toBeUndefined();
    });
  });

  describe('errors and the resilience layer (#724)', () => {
    const rpcError = (code: number, status: string, details: unknown[] = []) => () => ({
      __status: code,
      error: { code, message: `${status} from Gemini`, status, details },
    });
    const ok = textReply('好了', { promptTokenCount: 10, candidatesTokenCount: 2, totalTokenCount: 12 });

    const finished = (finishReason: string) => () => ({
      candidates: [{ content: { role: 'model', parts: [] }, finishReason }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 0, totalTokenCount: 10 },
    });
    const dailyQuota = rpcError(429, 'RESOURCE_EXHAUSTED', [
      {
        '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
        violations: [{ quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests', quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }],
      },
      // Gemini still sends a short RetryInfo on daily quotas; retrying after it cannot succeed.
      { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '14s' },
    ]);

    async function resilientRun(
      responses: Array<() => unknown>,
      options: { fallback?: boolean; config?: ProviderResilienceConfig; timers?: ProviderTimers; onHang?: () => void } = {},
    ) {
      const { runtime, model, fallback, captured } = setup(responses, {}, options.onHang);
      const events: ProviderResilienceEvent[] = [];
      const delays: number[] = [];
      const port = createResilientCompletionPort(runtime, {
        config: options.config,
        fallbackModels: options.fallback ? [fallback] : [],
        onEvent: (event) => events.push(event),
        sleep: async (ms) => { delays.push(ms); },
        random: () => 0.5,
        ...(options.timers ? { timers: options.timers } : {}),
      });
      const outcome = await port.complete(model, { systemPrompt: SYSTEM, messages: [createUserMessage('hi')] }).then(
        (message) => ({ message }),
        (error: unknown) => ({ error: error as Error & { kind?: string } }),
      );
      const models = captured.map((c) => (c.url.includes(FALLBACK) ? FALLBACK : PRIMARY));
      return { ...outcome, events, delays, requests: captured.length, models };
    }

    it('retries 429 RESOURCE_EXHAUSTED after the RetryInfo.retryDelay Gemini sends', async () => {
      const run = await resilientRun([
        rpcError(429, 'RESOURCE_EXHAUSTED', [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '3s' }]),
        ok,
      ]);
      expect(run.message?.stopReason).toBe('stop');
      expect(run.requests).toBe(2);
      expect(run.events[0]).toMatchObject({ type: 'retry', kind: 'rate_limit', delayMs: 3000 });
    });

    it.each([[500, 'INTERNAL'], [503, 'UNAVAILABLE']])('retries %s %s with backoff', async (code, status) => {
      const run = await resilientRun([rpcError(code, status), ok]);
      expect(run.message?.stopReason).toBe('stop');
      expect(run.events[0]).toMatchObject({ type: 'retry', kind: 'server' });
    });

    it('retries 504 DEADLINE_EXCEEDED as a timeout, and says so when retries run out', async () => {
      const recovered = await resilientRun([rpcError(504, 'DEADLINE_EXCEEDED'), ok]);
      expect(recovered.message?.stopReason).toBe('stop');
      expect(recovered.events[0]).toMatchObject({ type: 'retry', kind: 'timeout' });
      const exhausted = await resilientRun([rpcError(504, 'DEADLINE_EXCEEDED')]);
      expect(exhausted.error).toBeInstanceOf(ProviderRequestError);
      expect(exhausted.error?.message).toBe(describeProviderFailure('timeout'));
      expect(exhausted.requests).toBe(3);
    });

    it('falls back to the next model after 503 UNAVAILABLE retries run out', async () => {
      const unavailable = rpcError(503, 'UNAVAILABLE');
      const run = await resilientRun([unavailable, unavailable, unavailable, ok], { fallback: true });
      expect(run.message?.stopReason).toBe('stop');
      expect(run.models).toEqual([PRIMARY, PRIMARY, PRIMARY, FALLBACK]);
      expect(run.events.at(-1)).toMatchObject({ type: 'fallback', from: PRIMARY, to: FALLBACK, kind: 'server' });
    });

    it('falls back after 429 retries run out, and skips the retries when RetryInfo is too long', async () => {
      const longDelay = rpcError(429, 'RESOURCE_EXHAUSTED', [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '3600s' }]);
      const run = await resilientRun([longDelay, ok], { fallback: true });
      expect(run.models).toEqual([PRIMARY, FALLBACK]);
      expect(run.events).toEqual([expect.objectContaining({ type: 'fallback', kind: 'rate_limit' })]);
    });

    it('does not retry a per-day quota (QuotaFailure PerDay) but falls back to another model', async () => {
      const exhausted = await resilientRun([dailyQuota]);
      expect(classifyProviderError(exhausted.error?.cause)).toMatchObject({ kind: 'quota_exhausted', retryable: false, fallbackEligible: true });
      const run = await resilientRun([dailyQuota, ok], { fallback: true });
      expect(run.message?.stopReason).toBe('stop');
      expect(run.models).toEqual([PRIMARY, FALLBACK]);
      expect(run.delays).toEqual([]);
    });

    it('tells the user politely when a per-day quota leaves no model to fall back to', async () => {
      const run = await resilientRun([dailyQuota]);
      expect(run.requests).toBe(1);
      expect(run.error).toBeInstanceOf(ProviderRequestError);
      expect(run.error).toMatchObject({ kind: 'quota_exhausted' });
      expect(run.error?.message).toBe(describeProviderFailure('quota_exhausted'));
      expect(isProviderFailureMessage(run.error!.message)).toBe(true);
    });

    it('aborts a hung Gemini request at the per-attempt timeout and retries it (virtual timers)', async () => {
      const pending: Array<{ fn: () => void; ms: number }> = [];
      const timers: ProviderTimers = {
        setTimeout: (fn, ms) => { const timer = { fn, ms }; pending.push(timer); return timer; },
        clearTimeout: (handle) => { const i = pending.indexOf(handle as never); if (i >= 0) pending.splice(i, 1); },
      };
      const run = await resilientRun([() => HANG, ok], {
        config: { requestTimeoutMs: 45_000 },
        timers,
        // The hung request is pending: let its deadline pass without a real wait.
        onHang: () => pending.shift()?.fn(),
      });
      expect(run.message?.stopReason).toBe('stop');
      expect(run.requests).toBe(2);
      expect(run.events[0]).toMatchObject({ type: 'retry', kind: 'timeout' });
      expect(pending).toEqual([]);
    });

    it.each([
      ['a SAFETY finish', finished('SAFETY')],
      ['a PROHIBITED_CONTENT finish', finished('PROHIBITED_CONTENT')],
      ['a blocked prompt', () => ({ promptFeedback: { blockReason: 'PROHIBITED_CONTENT' }, usageMetadata: { promptTokenCount: 10, totalTokenCount: 10 } })],
    ])('passes %s to the user without retrying or falling back', async (_label, blocked) => {
      const run = await resilientRun([blocked, ok], { fallback: true, config: { emptyReplyRetries: 2 } });
      expect(run.requests).toBe(1);
      expect(run.models).toEqual([PRIMARY]);
      expect(run.message?.stopReason).toBe('error');
      expect(finishFailureKind(run.message?.errorMessage)).toBe('safety_block');
      expect(run.events).toEqual([expect.objectContaining({ type: 'refused', model: PRIMARY, kind: 'safety_block' })]);
    });

    it('re-asks MALFORMED_FUNCTION_CALL on the same model only when the preset opts in', async () => {
      const reasked = await resilientRun([finished('MALFORMED_FUNCTION_CALL'), ok], { fallback: true, config: { emptyReplyRetries: 1 } });
      expect(reasked.message?.stopReason).toBe('stop');
      expect(reasked.models).toEqual([PRIMARY, PRIMARY]);
      expect(reasked.events[0]).toMatchObject({ type: 'retry', kind: 'malformed_tool_call', delayMs: 0 });

      const passedThrough = await resilientRun([finished('MALFORMED_FUNCTION_CALL'), ok], { fallback: true });
      expect(passedThrough.requests).toBe(1);
      expect(passedThrough.message?.stopReason).toBe('error');
      expect(passedThrough.message?.errorMessage).toContain('MALFORMED_FUNCTION_CALL');
    });

    it('treats 400 API_KEY_INVALID as auth: no retry, no fallback', async () => {
      const run = await resilientRun([rpcError(400, 'INVALID_ARGUMENT', [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID' }])]);
      expect(classifyProviderError(run.error)).toMatchObject({ kind: 'auth', retryable: false, fallbackEligible: false });
      expect(run.requests).toBe(1);
    });

    it('does not retry an ordinary 400 INVALID_ARGUMENT', async () => {
      const run = await resilientRun([rpcError(400, 'INVALID_ARGUMENT')]);
      expect(classifyProviderError(run.error)).toMatchObject({ kind: 'bad_request', retryable: false });
      expect(run.requests).toBe(1);
    });

    it('classifies Google RPC statuses on errors without an HTTP status (stream error chunks)', () => {
      expect(classifyProviderError(new Error('got status: RESOURCE_EXHAUSTED'))).toMatchObject({ kind: 'rate_limit', retryable: true });
      expect(classifyProviderError(new Error('got status: UNAVAILABLE'))).toMatchObject({ kind: 'server', retryable: true });
      expect(classifyProviderError(new Error('DEADLINE_EXCEEDED'))).toMatchObject({ kind: 'timeout', retryable: true });
      expect(classifyProviderError({ name: 'AI_APICallError', message: 'x', data: { error: { status: 'UNAUTHENTICATED' } } })).toMatchObject({ kind: 'auth', retryable: false });
    });
  });

  it('applies provider-config safetySettings and thinkingConfig to every request', async () => {
    const safetySettings = [{ category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' }];
    const { runtime, model, captured } = setup(
      [textReply('ok', { promptTokenCount: 5, candidatesTokenCount: 1, totalTokenCount: 6 })],
      { providerOptions: { google: { safetySettings, thinkingConfig: { thinkingLevel: 'low' } } } },
    );
    await runtime.complete(model, { systemPrompt: SYSTEM, messages: [createUserMessage('hi')] });
    expect(captured[0]!.body.safetySettings).toEqual(safetySettings);
    expect(captured[0]!.body.generationConfig.thinkingConfig).toMatchObject({ thinkingLevel: 'low' });
  });
});

describe('Gemini streaming: thoughts and usage accounting (streamGenerateContent SSE)', () => {
  const finalUsage = {
    promptTokenCount: 5200,
    candidatesTokenCount: 12,
    thoughtsTokenCount: 80,
    cachedContentTokenCount: 4096,
    totalTokenCount: 5292,
  };

  it('surfaces thought parts as reasoning, keeps them out of visible text, and accounts every usage field', async () => {
    const deltas: Array<{ type: string; text?: string; thinking?: string }> = [];
    const { runtime, model, captured } = setup([() => ({ __chunks: [
      { candidates: [{ content: { role: 'model', parts: [{ text: '先想一下：用户要天气。', thought: true }] } }], usageMetadata: { promptTokenCount: 5200 } },
      { candidates: [{ content: { role: 'model', parts: [{ text: '内部推理第二段', thought: true }] } }] },
      { candidates: [{ content: { role: 'model', parts: [{ text: '上海今天' }] } }] },
      { candidates: [{ content: { role: 'model', parts: [{ text: '晴。' }] }, finishReason: 'STOP' }], usageMetadata: finalUsage },
    ] })], { providerOptions: { google: { thinkingConfig: { includeThoughts: true } } } });
    const stream = runtime.stream(model, { systemPrompt: SYSTEM, messages: [createUserMessage('上海天气？')] });
    let message: AssistantMessage | undefined;
    for await (const event of stream) {
      if (event.type === 'text_delta' || event.type === 'thinking_delta') deltas.push(event as never);
      if (event.type === 'done' && event.message) message = event.message;
    }
    if (!message) throw new Error('stream ended without a message');

    expect(captured[0]!.url).toContain('streamGenerateContent');
    expect(captured[0]!.body.generationConfig.thinkingConfig).toMatchObject({ includeThoughts: true });
    const visible = message.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('');
    expect(visible).toBe('上海今天晴。');
    expect(visible).not.toContain('推理');
    const thinking = message.content.filter((b) => b.type === 'thinking').map((b) => (b as { thinking: string }).thinking).join('');
    expect(thinking).toContain('先想一下');
    expect(thinking).toContain('内部推理第二段');
    expect(deltas.filter((d) => d.type === 'text_delta').map((d) => d.text).join('')).toBe('上海今天晴。');
    expect(deltas.filter((d) => d.type === 'thinking_delta').map((d) => d.thinking).join('')).toContain('内部推理');

    expect(message.usage).toMatchObject({
      input: 5200, // promptTokenCount (includes the cached part)
      cacheRead: 4096, // cachedContentTokenCount
      output: 92, // candidatesTokenCount + thoughtsTokenCount
      reasoning: 80, // thoughtsTokenCount
      totalTokens: 5292,
    });
  });

  it('accounts usage on a streamed function-call turn', async () => {
    const { runtime, model } = setup([() => ({ __chunks: [
      { candidates: [{ content: { role: 'model', parts: [{ text: '要查天气', thought: true }] } }] },
      { candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'get_weather', args: { city: '上海' } }, thoughtSignature: 'c2ln' }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 4300, candidatesTokenCount: 9, thoughtsTokenCount: 40, cachedContentTokenCount: 4096, totalTokenCount: 4349 } },
    ] })], { providerOptions: { google: { thinkingConfig: { includeThoughts: true } } } });
    const message = await runtime.complete(model, { systemPrompt: SYSTEM, messages: [createUserMessage('上海天气？')], tools: [weather] });
    expect(message.stopReason).toBe('toolCalls');
    expect(message.content.filter((b) => b.type === 'text')).toEqual([]);
    expect(message.usage).toMatchObject({ input: 4300, cacheRead: 4096, output: 49, reasoning: 40, totalTokens: 4349 });
  });
});
