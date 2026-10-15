/**
 * Baseline: `sdk: openai-compatible` (@ai-sdk/openai-compatible) over a mocked
 * HTTP endpoint. Gateways (OpenRouter, NVIDIA NIM, OpenCode, Cloudflare) use this path.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { classifyProviderError } from '../../../src/llm/provider-resilience.js';
import { normalizeOpenAiCompatibleBaseUrl } from '../../../src/llm/sdk-registry.js';
import { createProviderHarness, openaiChat, TEST_API_KEY } from '../../helpers/provider-harness/index.js';

const weather = { name: 'get_weather', description: 'Weather for one city.', parameters: z.object({ city: z.string() }) };

describe('openai-compatible provider (baseline)', () => {
  it('streams text with bearer auth and a system message', async () => {
    const h = createProviderHarness({ sdk: 'openai-compatible' });
    h.reply(openaiChat.reply({ text: '你好' }));
    const message = await h.complete({ system: 'sys', user: 'hi' });
    const req = h.lastRequest();
    expect(req.url).toBe('https://gateway.test/v1/chat/completions');
    expect(req.headers.authorization).toBe(`Bearer ${TEST_API_KEY}`);
    expect(req.rawBody).not.toContain(TEST_API_KEY);
    expect(req.body.messages[0]).toEqual({ role: 'system', content: 'sys' });
    expect(message.content).toEqual([{ type: 'text', text: '你好' }]);
  });

  it('keeps reasoning_content from gateways as thinking and replays it on tool calls', async () => {
    const h = createProviderHarness({ sdk: 'openai-compatible', model: 'deepseek-r1' });
    h.reply(
      openaiChat.reply({ reasoning: '思考', toolCalls: [{ name: 'get_weather', arguments: { city: '上海' } }] }),
      openaiChat.reply({ text: '晴' }),
    );
    const first = await h.complete({ user: '天气？', tools: [weather] });
    expect(first.content).toEqual(expect.arrayContaining([{ type: 'thinking', thinking: '思考' }]));
    await h.complete({
      messages: [
        ...h.context({ user: '天气？' }).messages,
        first,
        { role: 'toolResult', toolCallId: 'call_0', toolName: 'get_weather', content: [{ type: 'text', text: '晴' }], isError: false, timestamp: 1 },
      ],
      tools: [weather],
    });
    const assistant = h.lastRequest().body.messages.find((m: { role: string }) => m.role === 'assistant');
    expect(assistant).toMatchObject({ reasoning_content: '思考' });
  });

  it('appends /v1 to a bare gateway root', async () => {
    const h = createProviderHarness({ sdk: 'openai-compatible', config: { baseUrl: 'https://gateway.test' } });
    h.reply(openaiChat.reply({ text: 'ok' }));
    await h.complete('hi');
    expect(h.lastRequest().url).toBe('https://gateway.test/v1/chat/completions');
  });

  it('classifies an upstream 429 as a rate limit', async () => {
    const h = createProviderHarness({ sdk: 'openai-compatible' });
    h.reply(openaiChat.error(429, { message: 'Too many requests' }));
    const error = await h.complete('hi', { maxRetries: 0 }).catch((e: unknown) => e);
    expect(classifyProviderError(error)).toMatchObject({ kind: 'rate_limit', retryable: true });
  });

  it('requests and reports streamed usage (stream_options.include_usage)', async () => {
    const h = createProviderHarness({ sdk: 'openai-compatible' });
    h.reply(openaiChat.reply({ text: 'ok', usage: { prompt: 50, completion: 7, cached: 40, reasoning: 3 } }));
    const message = await h.complete('hi');
    expect(h.lastRequest().body.stream_options).toEqual({ include_usage: true });
    expect(message.usage).toMatchObject({ input: 50, output: 7, cacheRead: 40, reasoning: 3, totalTokens: 57 });
  });

  it('lets a server that rejects stream_options opt out with compat.includeUsage: false', async () => {
    const h = createProviderHarness({ sdk: 'openai-compatible', config: { compat: { includeUsage: false } } });
    h.reply(openaiChat.reply({ text: 'ok', usage: { prompt: 50, completion: 7 } }));
    const message = await h.complete('hi');
    expect(h.lastRequest().body.stream_options).toBeUndefined();
    expect(message.usage.input).toBe(0);
  });

  it.each([
    ['https://gw.test', 'https://gw.test/v1'],
    ['https://gw.test/', 'https://gw.test/v1'],
    ['https://openrouter.ai/api', 'https://openrouter.ai/api/v1'],
    ['https://openrouter.ai/api/v1/', 'https://openrouter.ai/api/v1'],
    ['https://ark.cn-beijing.volces.com/api/v3', 'https://ark.cn-beijing.volces.com/api/v3'],
    ['https://open.bigmodel.cn/api/paas/v4', 'https://open.bigmodel.cn/api/paas/v4'],
    ['https://generativelanguage.googleapis.com/v1beta/openai', 'https://generativelanguage.googleapis.com/v1beta/openai'],
    ['https://api.cloudflare.com/client/v4/accounts/acc/ai/v1', 'https://api.cloudflare.com/client/v4/accounts/acc/ai/v1'],
    ['https://gw.test/openai', 'https://gw.test/openai'],
  ])('normalizes baseUrl %s to %s', (input, expected) => {
    expect(normalizeOpenAiCompatibleBaseUrl(input)).toBe(expected);
  });

  it('honours compat.appendV1 in both directions', () => {
    expect(normalizeOpenAiCompatibleBaseUrl('https://gw.test/api/v3', true)).toBe('https://gw.test/api/v3/v1');
    expect(normalizeOpenAiCompatibleBaseUrl('https://gw.test/custom/', false)).toBe('https://gw.test/custom');
  });

  it('posts to a versioned gateway path as written', async () => {
    const h = createProviderHarness({ sdk: 'openai-compatible', config: { baseUrl: 'https://open.bigmodel.cn/api/paas/v4' } });
    h.reply(openaiChat.reply({ text: 'ok' }));
    await h.complete('hi');
    expect(h.lastRequest().url).toBe('https://open.bigmodel.cn/api/paas/v4/chat/completions');
  });

  it('discovers models next to /chat/completions', async () => {
    const h = createProviderHarness({ sdk: 'openai-compatible', config: { baseUrl: 'https://gw.test' } });
    h.server.route((r) => r.method === 'GET', { json: { data: [{ id: 'a' }, { id: 'b' }] } });
    await expect(h.adapter().listModels()).resolves.toEqual(['a', 'b']);
    expect(h.lastRequest().url).toBe('https://gw.test/v1/models');
  });

  it('sends prompt_cache_key only when compat.promptCacheKey is set', async () => {
    const plain = createProviderHarness({ sdk: 'openai-compatible' });
    plain.reply(openaiChat.reply({ text: 'ok' }));
    await plain.complete('hi', { promptCacheKey: 'zhin:a:b:c' });
    expect(plain.lastRequest().body).not.toHaveProperty('prompt_cache_key');
    expect(plain.lastRequest().body).not.toHaveProperty('promptCacheKey');

    const keyed = createProviderHarness({ sdk: 'openai-compatible', config: { compat: { promptCacheKey: true } } });
    keyed.reply(openaiChat.reply({ text: 'ok' }));
    await keyed.complete('hi', { promptCacheKey: 'zhin:a:b:c', promptCacheRetention: '24h' });
    expect(keyed.lastRequest().body).toMatchObject({ prompt_cache_key: 'zhin:a:b:c', prompt_cache_retention: '24h' });
  });
});
