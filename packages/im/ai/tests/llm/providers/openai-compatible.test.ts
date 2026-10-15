/**
 * Baseline: `sdk: openai-compatible` (@ai-sdk/openai-compatible) over a mocked
 * HTTP endpoint. Gateways (OpenRouter, NVIDIA NIM, OpenCode, Cloudflare) use this path.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { classifyProviderError } from '../../../src/llm/provider-resilience.js';
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
});
