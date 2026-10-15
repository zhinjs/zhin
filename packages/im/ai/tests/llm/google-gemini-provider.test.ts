/**
 * Gemini over the real @ai-sdk/google transport with a mocked HTTP endpoint:
 * image input, function calling, a stable cacheable prefix across turns, and
 * implicit-cache token counts (usageMetadata.cachedContentTokenCount) (#769).
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createLlmApiRuntime } from '../../src/llm/llm-runtime-factory.js';
import { createLlmTransportModel, defaultModelInput } from '../../src/llm/llm-api-runtime.js';
import { createUserMessage } from '../../src/llm/types/agent-message.js';
import type { ProviderInstanceConfig } from '../../src/llm/types/model.js';
import { classifyProviderError, createResilientCompletionPort, isProviderFailureMessage, type ProviderResilienceEvent } from '../../src/llm/provider-resilience.js';

const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

type Captured = { url: string; body: Record<string, any> };

function sse(chunks: unknown[]): Response {
  const text = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\r\n\r\n`).join('');
  return new Response(text, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function geminiServer(responses: Array<(body: Record<string, any>) => unknown>) {
  const captured: Captured[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const body = JSON.parse(String(init?.body ?? '{}'));
    captured.push({ url, body });
    const respond = responses[Math.min(captured.length - 1, responses.length - 1)]!;
    const payload = respond(body) as { __chunks?: unknown[]; __status?: number };
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

function setup(responses: Array<(body: Record<string, any>) => unknown>, extra: Partial<ProviderInstanceConfig> = {}) {
  const server = geminiServer(responses);
  const config: ProviderInstanceConfig = { sdk: 'google', apiKey: 'test-key', ...extra };
  const runtime = createLlmApiRuntime([{ alias: 'gemini', config, models: ['gemini-3.8-flash'], fetch: server.fetch }], () => ['gemini-3.8-flash']);
  const model = createLlmTransportModel('gemini', config, 'gemini-3.8-flash');
  return { runtime, model, captured: server.captured };
}

const weather = { name: 'get_weather', description: 'Weather for one city.', parameters: z.object({ city: z.string() }) };
const SYSTEM = 'You are zhin, a group-chat assistant. '.repeat(50);

describe('Gemini provider (google sdk)', () => {
  it('defaults Gemini chat models to multimodal input, but not TTS/embedding models or other SDKs', () => {
    expect(defaultModelInput('google', 'gemini-3.8-flash')).toContain('image');
    expect(defaultModelInput('google', 'gemini-3.8-flash-tts')).toEqual(['text']);
    expect(defaultModelInput('google', 'gemini-embedding-001')).toEqual(['text']);
    expect(defaultModelInput('openai', 'gpt-5')).toEqual(['text']);
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

    it.each(['SAFETY', 'RECITATION', 'PROHIBITED_CONTENT', 'BLOCKLIST'])('surfaces %s as a visible refusal, not an empty reply', async (reason) => {
      const message = await ask(finished(reason));
      expect(message.stopReason).toBe('error');
      expect(message.errorMessage).toContain(reason);
      expect(isProviderFailureMessage(message.errorMessage!)).toBe(true);
    });

    it('surfaces a blocked prompt (promptFeedback.blockReason, no candidates)', async () => {
      const message = await ask(() => ({ promptFeedback: { blockReason: 'SAFETY' }, usageMetadata }));
      expect(message.stopReason).toBe('error');
      expect(message.errorMessage).toContain('prompt SAFETY');
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

    async function resilientRun(responses: Array<() => unknown>) {
      const { runtime, model, captured } = setup(responses);
      const events: ProviderResilienceEvent[] = [];
      const delays: number[] = [];
      const port = createResilientCompletionPort(runtime, {
        onEvent: (event) => events.push(event),
        sleep: async (ms) => { delays.push(ms); },
        random: () => 0.5,
      });
      const outcome = await port.complete(model, { systemPrompt: SYSTEM, messages: [createUserMessage('hi')] }).then(
        (message) => ({ message }),
        (error: unknown) => ({ error: error as Error & { kind?: string } }),
      );
      return { ...outcome, events, delays, requests: captured.length };
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

    it.each([[500, 'INTERNAL'], [503, 'UNAVAILABLE'], [504, 'DEADLINE_EXCEEDED']])('retries %s %s with backoff', async (code, status) => {
      const run = await resilientRun([rpcError(code, status), ok]);
      expect(run.message?.stopReason).toBe('stop');
      expect(run.events[0]).toMatchObject({ type: 'retry', kind: 'server' });
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
