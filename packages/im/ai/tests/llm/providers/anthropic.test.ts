/**
 * Baseline: `sdk: anthropic` (Messages API via @ai-sdk/anthropic) over a mocked
 * HTTP endpoint. See tests/helpers/provider-harness.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { classifyProviderError } from '../../../src/llm/provider-resilience.js';
import { anthropicMessages, createProviderHarness, TEST_API_KEY } from '../../helpers/provider-harness/index.js';

const weather = { name: 'get_weather', description: 'Weather for one city.', parameters: z.object({ city: z.string() }) };

describe('anthropic provider (baseline)', () => {
  it('streams text, sends a cacheable system block, and reports cache usage', async () => {
    const h = createProviderHarness({ sdk: 'anthropic' });
    h.reply(anthropicMessages.reply({ text: '你好呀', usage: { input: 30, output: 4, cacheRead: 100, cacheWrite: 20 } }));
    const message = await h.complete({ system: 'You are zhin.', user: '你好' });

    const req = h.lastRequest();
    expect(req.url).toBe('https://api.anthropic.com/v1/messages');
    expect(req.headers['x-api-key']).toBe(TEST_API_KEY);
    expect(req.rawBody).not.toContain(TEST_API_KEY);
    expect(req.body.system).toEqual([{ type: 'text', text: 'You are zhin.', cache_control: { type: 'ephemeral' } }]);
    expect(req.body.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: '你好', cache_control: { type: 'ephemeral' } }] }]);

    expect(message.stopReason).toBe('stop');
    expect(message.content).toEqual([{ type: 'text', text: '你好呀' }]);
    // input = uncached + cache read + cache write (AI SDK convention).
    expect(message.usage).toMatchObject({ input: 150, output: 4, cacheRead: 100, cacheWrite: 20 });
  });

  it('assembles parallel tool_use blocks streamed as input_json_delta', async () => {
    const h = createProviderHarness({ sdk: 'anthropic' });
    h.reply(anthropicMessages.reply({ toolCalls: [{ name: 'get_weather', arguments: { city: '上海' } }, { name: 'get_weather', arguments: { city: '北京' } }], deltas: 3 }));
    const message = await h.complete({ user: '天气？', tools: [weather] });
    expect(h.lastRequest().body.tools.at(-1)).toMatchObject({ name: 'get_weather', cache_control: { type: 'ephemeral' } });
    expect(message.stopReason).toBe('toolCalls');
    expect(message.content.filter((b) => b.type === 'toolCall')).toEqual([
      expect.objectContaining({ id: 'toolu_0', arguments: { city: '上海' } }),
      expect.objectContaining({ id: 'toolu_1', arguments: { city: '北京' } }),
    ]);
  });

  it('keeps signed thinking for replay', async () => {
    const h = createProviderHarness({ sdk: 'anthropic' });
    h.reply(anthropicMessages.reply({ blocks: [{ type: 'thinking', thinking: '想一想', signature: 'sig-1' }], text: '好' }));
    const message = await h.complete('hi');
    expect(message.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'thinking', thinking: '想一想', providerOptions: { anthropic: { signature: 'sig-1' } } }),
    ]));
  });

  it('maps refusal and max_tokens stop reasons', async () => {
    const h = createProviderHarness({ sdk: 'anthropic' });
    h.reply(anthropicMessages.reply({ stopReason: 'refusal' }), anthropicMessages.reply({ text: '半句', stopReason: 'max_tokens' }));
    const refused = await h.complete('a');
    expect(refused.stopReason).toBe('error');
    expect(refused.errorMessage).toContain('refusal');
    expect((await h.complete('b')).stopReason).toBe('length');
  });

  it('classifies 529 overloaded as a retryable server error', async () => {
    const h = createProviderHarness({ sdk: 'anthropic' });
    h.reply(anthropicMessages.error(529, { type: 'overloaded_error', message: 'Overloaded' }));
    const error = await h.complete('hi', { maxRetries: 0 }).catch((e: unknown) => e);
    expect(classifyProviderError(error)).toMatchObject({ kind: 'server', retryable: true, status: 529 });
  });

  it('appends /v1 to a proxy root and sends custom headers', async () => {
    const h = createProviderHarness({ sdk: 'anthropic', config: { baseUrl: 'https://proxy.test/', headers: { 'x-team': 'zhin' } } });
    h.reply(anthropicMessages.reply({ text: 'ok' }));
    await h.complete('hi');
    expect(h.lastRequest().url).toBe('https://proxy.test/v1/messages');
    expect(h.lastRequest().headers['x-team']).toBe('zhin');
  });
});
