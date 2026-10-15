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
    const payload = respond(body);
    return url.includes('streamGenerateContent') ? sse([payload]) : new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof globalThis.fetch;
  return { fetch, captured };
}

const textReply = (text: string, usage: Record<string, number>) => () => ({
  candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }],
  usageMetadata: usage,
});

function setup(responses: Array<(body: Record<string, any>) => unknown>) {
  const server = geminiServer(responses);
  const config: ProviderInstanceConfig = { sdk: 'google', apiKey: 'test-key' };
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
});
