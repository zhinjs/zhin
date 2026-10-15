/**
 * Baseline: `sdk: minimax` (@ai-sdk/minimax, Anthropic Messages wire format)
 * over a mocked HTTP endpoint. See tests/helpers/provider-harness.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { anthropicMessages, createProviderHarness, TEST_API_KEY } from '../../helpers/provider-harness/index.js';

const weather = { name: 'get_weather', description: 'Weather for one city.', parameters: z.object({ city: z.string() }) };

describe('minimax provider (baseline)', () => {
  it('talks Anthropic Messages to the MiniMax endpoint with adaptive thinking', async () => {
    const h = createProviderHarness({ sdk: 'minimax' });
    h.reply(anthropicMessages.reply({ text: '你好', usage: { input: 12, output: 3 } }));
    const message = await h.complete({ system: 'sys', user: 'hi' });
    const req = h.lastRequest();
    expect(req.url).toBe('https://api.minimax.io/anthropic/v1/messages');
    expect(req.rawBody).not.toContain(TEST_API_KEY);
    expect(req.body.thinking).toEqual({ type: 'adaptive' });
    expect(message.content).toEqual([{ type: 'text', text: '你好' }]);
    expect(message.usage).toMatchObject({ input: 12, output: 3 });
  });

  it('parses streamed tool_use and never replays unsigned thinking', async () => {
    const h = createProviderHarness({ sdk: 'minimax' });
    h.reply(
      anthropicMessages.reply({ blocks: [{ type: 'thinking', thinking: '内部推理' }], toolCalls: [{ name: 'get_weather', arguments: { city: '上海' } }] }),
      anthropicMessages.reply({ text: '晴' }),
    );
    const first = await h.complete({ user: '天气？', tools: [weather] });
    expect(first.content.filter((b) => b.type === 'toolCall')).toEqual([expect.objectContaining({ name: 'get_weather', arguments: { city: '上海' } })]);
    await h.complete({
      messages: [
        ...h.context({ user: '天气？' }).messages,
        first,
        { role: 'toolResult', toolCallId: 'toolu_0', toolName: 'get_weather', content: [{ type: 'text', text: '晴' }], isError: false, timestamp: 1 },
      ],
      tools: [weather],
    });
    const assistant = h.lastRequest().body.messages.find((m: { role: string }) => m.role === 'assistant');
    expect(assistant.content.map((c: { type: string }) => c.type)).toEqual(['tool_use']);
  });

  it.each([
    ['https://api.minimaxi.com/anthropic', 'https://api.minimaxi.com/anthropic/v1/messages'],
    ['https://api.minimaxi.com/anthropic/v1/', 'https://api.minimaxi.com/anthropic/v1/messages'],
    ['https://api.minimaxi.com', 'https://api.minimaxi.com/anthropic/v1/messages'],
    ['https://proxy.test/minimax/v1', 'https://proxy.test/minimax/v1/messages'],
  ])('normalizes baseUrl %s to the Anthropic-protocol endpoint', async (baseUrl, url) => {
    const h = createProviderHarness({ sdk: 'minimax', config: { baseUrl } });
    h.reply(anthropicMessages.reply({ text: 'ok' }));
    await h.complete('hi');
    expect(h.lastRequest().url).toBe(url);
  });
});

