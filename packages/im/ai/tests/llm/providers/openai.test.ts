/**
 * Baseline: `sdk: openai` (OpenAI Chat Completions via @ai-sdk/openai) over a
 * mocked HTTP endpoint. See tests/helpers/provider-harness.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { classifyProviderError } from '../../../src/llm/provider-resilience.js';
import { generateTextViaAiSdk } from '../../../src/llm/bridge/ai-sdk-stream.js';
import { createProviderHarness, openaiChat, TEST_API_KEY } from '../../helpers/provider-harness/index.js';

const weather = { name: 'get_weather', description: 'Weather for one city.', parameters: z.object({ city: z.string() }) };

describe('openai provider (baseline)', () => {
  it('streams text, sends the system prompt as a developer message, and reports usage', async () => {
    const h = createProviderHarness({ sdk: 'openai' });
    h.reply(openaiChat.reply({ text: '你好呀', usage: { prompt: 20, completion: 4, cached: 8, reasoning: 2 } }));
    const message = await h.complete({ system: 'You are zhin.', user: '你好' });

    const req = h.lastRequest();
    expect(req.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(req.stream).toBe(true);
    expect(req.body.stream_options).toEqual({ include_usage: true });
    // GPT-5 family is a reasoning model: @ai-sdk/openai sends the system prompt with the developer role.
    expect(req.body.messages[0]).toEqual({ role: 'developer', content: 'You are zhin.' });
    expect(req.body.messages.at(-1)).toEqual({ role: 'user', content: '你好' });
    expect(req.headers.authorization).toBe(`Bearer ${TEST_API_KEY}`);
    expect(req.rawBody).not.toContain(TEST_API_KEY);

    expect(message.stopReason).toBe('stop');
    expect(message.content).toEqual([{ type: 'text', text: '你好呀' }]);
    expect(message.usage).toMatchObject({ input: 20, output: 4, cacheRead: 8, totalTokens: 24, reasoning: 2 });
  });

  it('assembles parallel tool calls streamed across deltas and replays the tool result', async () => {
    const h = createProviderHarness({ sdk: 'openai' });
    h.reply(
      openaiChat.reply({ toolCalls: [{ name: 'get_weather', arguments: { city: '上海' } }, { name: 'get_weather', arguments: { city: '北京' } }], deltas: 3 }),
      openaiChat.reply({ text: '都是晴天' }),
    );
    const first = await h.complete({ user: '上海和北京天气？', tools: [weather] });
    expect(h.lastRequest().body.tools[0]).toMatchObject({ type: 'function', function: { name: 'get_weather' } });
    expect(first.stopReason).toBe('toolCalls');
    const calls = first.content.filter((b) => b.type === 'toolCall');
    expect(calls).toEqual([
      expect.objectContaining({ id: 'call_0', name: 'get_weather', arguments: { city: '上海' } }),
      expect.objectContaining({ id: 'call_1', name: 'get_weather', arguments: { city: '北京' } }),
    ]);

    await h.complete({
      messages: [
        ...h.context({ user: '上海和北京天气？' }).messages,
        first,
        { role: 'toolResult', toolCallId: 'call_0', toolName: 'get_weather', content: [{ type: 'text', text: '晴' }], isError: false, timestamp: 1 },
        { role: 'toolResult', toolCallId: 'call_1', toolName: 'get_weather', content: [{ type: 'text', text: '晴' }], isError: false, timestamp: 1 },
      ],
      tools: [weather],
    });
    const messages = h.lastRequest().body.messages;
    expect(messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'assistant', tool_calls: [expect.objectContaining({ id: 'call_0' }), expect.objectContaining({ id: 'call_1' })] }),
      { role: 'tool', tool_call_id: 'call_0', content: '晴' },
      { role: 'tool', tool_call_id: 'call_1', content: '晴' },
    ]));
  });

  it('maps length and content_filter finish reasons', async () => {
    const h = createProviderHarness({ sdk: 'openai' });
    h.reply(openaiChat.reply({ text: '半句', finishReason: 'length' }), openaiChat.reply({ finishReason: 'content_filter' }));
    expect((await h.complete('a')).stopReason).toBe('length');
    const filtered = await h.complete('b');
    expect(filtered.stopReason).toBe('error');
    expect(filtered.errorMessage).toContain('content_filter');
  });

  it('classifies a 429 with Retry-After for the resilience layer', async () => {
    const h = createProviderHarness({ sdk: 'openai' });
    h.reply(openaiChat.error(429, { message: 'Rate limit reached', type: 'rate_limit_exceeded' }, { 'retry-after': '2' }));
    const error = await h.complete('hi', { maxRetries: 0 }).catch((e: unknown) => e);
    expect(classifyProviderError(error)).toMatchObject({ kind: 'rate_limit', retryable: true, retryAfterMs: 2_000 });
  });

  it('sends custom headers and keeps a baseUrl that already has /v1', async () => {
    const h = createProviderHarness({ sdk: 'openai', config: { baseUrl: 'https://proxy.test/v1/', headers: { 'x-team': 'zhin' } } });
    h.reply(openaiChat.reply({ text: 'ok' }));
    await h.complete('hi');
    expect(h.lastRequest().url).toBe('https://proxy.test/v1/chat/completions');
    expect(h.lastRequest().headers['x-team']).toBe('zhin');
  });

  it.each([
    ['https://proxy.test', 'https://proxy.test/v1/chat/completions'],
    ['https://proxy.test/api/', 'https://proxy.test/api/v1/chat/completions'],
    ['https://res.test/openai', 'https://res.test/openai/chat/completions'],
    ['https://gw.test/api/v3', 'https://gw.test/api/v3/chat/completions'],
  ])('normalizes baseUrl %s like the other OpenAI-protocol providers', async (baseUrl, url) => {
    const h = createProviderHarness({ sdk: 'openai', config: { baseUrl } });
    h.reply(openaiChat.reply({ text: 'ok' }));
    await h.complete('hi');
    expect(h.lastRequest().url).toBe(url);
  });

  it('uses baseUrl as written with compat.appendV1: false', async () => {
    const h = createProviderHarness({ sdk: 'openai', config: { baseUrl: 'https://proxy.test', compat: { appendV1: false } } });
    h.reply(openaiChat.reply({ text: 'ok' }));
    await h.complete('hi');
    expect(h.lastRequest().url).toBe('https://proxy.test/chat/completions');
  });

  it.each([
    ['Token', 'Token test-key'],
    ['Bearer ', 'Bearer test-key'],
    ['', 'test-key'],
  ])('honours authScheme %j on chat requests and model discovery', async (authScheme, header) => {
    const h = createProviderHarness({ sdk: 'openai', config: { authScheme, baseUrl: 'https://proxy.test/v1' } });
    h.reply(openaiChat.reply({ text: 'ok' }));
    await h.complete('hi');
    expect(h.lastRequest().headers.authorization).toBe(header);
    h.server.route((req) => req.path.endsWith('/models'), { json: { data: [{ id: 'm1' }] } });
    await h.adapter().listModels();
    expect(h.server.requestsTo('/models')[0]?.headers.authorization).toBe(header);
  });

  it('sends system instead of developer with compat.supportsDeveloperRole: false', async () => {
    const h = createProviderHarness({ sdk: 'openai', config: { compat: { supportsDeveloperRole: false } } });
    h.reply(openaiChat.reply({ text: 'ok' }));
    await h.complete({ system: 'be brief', user: 'hi' });
    expect(h.lastRequest().body.messages[0]).toEqual({ role: 'system', content: 'be brief' });
  });

  it('surfaces a streamed refusal instead of an empty reply', async () => {
    const h = createProviderHarness({ sdk: 'openai' });
    h.reply(openaiChat.reply({ refusal: "I'm sorry, I can't help with that." }));
    const message = await h.complete('something disallowed');
    expect(message.stopReason).toBe('error');
    expect(message.errorMessage).toContain('内容安全策略');
    expect(message.errorMessage).toContain("refusal: I'm sorry, I can't help with that.");
  });

  it('surfaces a refusal on the non-streaming path', async () => {
    const h = createProviderHarness({ sdk: 'openai' });
    h.reply(openaiChat.reply({ refusal: 'No.' }));
    const languageModel = h.runtime.resolveLanguageModel(h.alias, h.modelId)!;
    const message = await generateTextViaAiSdk(languageModel, h.model, h.context('x'));
    expect(h.lastRequest().stream).toBe(false);
    expect(message.stopReason).toBe('error');
    expect(message.errorMessage).toContain('refusal: No.');
  });

  it('keeps text when a reply has both text and a refusal field', async () => {
    const h = createProviderHarness({ sdk: 'openai' });
    h.reply(openaiChat.reply({ text: 'Here is a safe answer.', refusal: 'partial' }));
    const message = await h.complete('hi');
    expect(message.stopReason).toBe('stop');
    expect(message.errorMessage).toBeUndefined();
  });

  it('aborts a stream that goes silent (chunkTimeoutMs) as a retryable timeout', async () => {
    const h = createProviderHarness({ sdk: 'openai', config: { chunkTimeoutMs: 50 } });
    expect(h.model.streamTimeout).toEqual({ chunkMs: 50 });
    const stalled = openaiChat.reply({ text: 'partial' }).stream({ body: {} } as never);
    h.reply({ sse: (stalled.sse ?? []).slice(0, 2), hang: 'after-events' });
    const error = await h.complete('hi', { maxRetries: 0 }).catch((e: unknown) => e);
    expect(classifyProviderError(error)).toMatchObject({ kind: 'timeout', retryable: true });
  });

  it('aborts a request whose first chunk never comes (firstChunkTimeoutMs) and fails over on retry', async () => {
    const h = createProviderHarness({ sdk: 'openai', config: { firstChunkTimeoutMs: 50 } });
    h.reply({ hang: 'before-headers' }, openaiChat.reply({ text: '恢复了' }));
    const error = await h.complete('hi', { maxRetries: 0 }).catch((e: unknown) => e);
    expect(classifyProviderError(error)).toMatchObject({ kind: 'timeout', retryable: true });
    const message = await h.resilient({ config: { maxRetries: 1, baseDelayMs: 1, maxDelayMs: 1 } }).complete('again');
    expect(message.content).toEqual([{ type: 'text', text: '恢复了' }]);
  });

  it('leaves stall timeouts off by default', () => {
    expect(createProviderHarness({ sdk: 'openai' }).model.streamTimeout).toBeUndefined();
  });
});
