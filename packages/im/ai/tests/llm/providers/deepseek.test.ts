/**
 * Baseline: `sdk: deepseek` (@ai-sdk/deepseek, OpenAI Chat wire format) over a
 * mocked HTTP endpoint. See tests/helpers/provider-harness.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { classifyProviderError } from '../../../src/llm/provider-resilience.js';
import { createProviderHarness, openaiChat } from '../../helpers/provider-harness/index.js';

const weather = { name: 'get_weather', description: 'Weather for one city.', parameters: z.object({ city: z.string() }) };

describe('deepseek provider (baseline)', () => {
  it('streams reasoning_content as thinking and reports cache-hit and reasoning tokens', async () => {
    const h = createProviderHarness({ sdk: 'deepseek' });
    h.reply(openaiChat.reply({ reasoning: '先想想', text: '答案', usage: { prompt: 40, completion: 10, cacheHit: 32, reasoning: 6 } }));
    const events = await h.events({ system: 'sys', user: 'q' });
    const message = events.find((e) => e.type === 'done')!.message!;

    const req = h.lastRequest();
    expect(req.url).toBe('https://api.deepseek.com/chat/completions');
    expect(req.body.stream_options).toEqual({ include_usage: true });
    expect(req.body.messages[0]).toEqual({ role: 'system', content: 'sys' });
    expect(events.some((e) => e.type === 'thinking_delta')).toBe(true);
    // Thinking precedes text (S6, #782), matching the order the model produced them.
    expect(message.content).toEqual([{ type: 'thinking', thinking: '先想想' }, { type: 'text', text: '答案' }]);
    expect(message.usage).toMatchObject({ input: 40, output: 10, cacheRead: 32, reasoning: 6 });
  });

  it('replays reasoning_content on the assistant tool-call turn', async () => {
    const h = createProviderHarness({ sdk: 'deepseek' });
    h.reply(
      openaiChat.reply({ reasoning: '查天气', toolCalls: [{ name: 'get_weather', arguments: { city: '上海' } }] }),
      openaiChat.reply({ text: '晴' }),
    );
    const first = await h.complete({ user: '上海？', tools: [weather] });
    expect(first.stopReason).toBe('toolCalls');
    await h.complete({
      messages: [
        ...h.context({ user: '上海？' }).messages,
        first,
        { role: 'toolResult', toolCallId: 'call_0', toolName: 'get_weather', content: [{ type: 'text', text: '晴' }], isError: false, timestamp: 1 },
      ],
      tools: [weather],
    });
    const assistant = h.lastRequest().body.messages.find((m: { role: string }) => m.role === 'assistant');
    expect(assistant).toMatchObject({ reasoning_content: '查天气', tool_calls: [expect.objectContaining({ id: 'call_0' })] });
  });

  it('classifies a 503 as a retryable server error', async () => {
    const h = createProviderHarness({ sdk: 'deepseek' });
    h.reply(openaiChat.error(503, { message: 'Server overloaded', type: 'server_error' }));
    const error = await h.complete('hi', { maxRetries: 0 }).catch((e: unknown) => e);
    expect(classifyProviderError(error)).toMatchObject({ kind: 'server', retryable: true, status: 503 });
  });
});
