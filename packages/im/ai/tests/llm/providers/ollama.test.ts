/**
 * Baseline: `sdk: ollama` (Ollama's OpenAI-compatible /v1 API via
 * @ai-sdk/openai-compatible) over a mocked HTTP endpoint.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createProviderHarness, openaiChat } from '../../helpers/provider-harness/index.js';

const weather = { name: 'get_weather', description: 'Weather for one city.', parameters: z.object({ city: z.string() }) };

describe('ollama provider (baseline)', () => {
  it('posts to host + /v1 without an Authorization header', async () => {
    const h = createProviderHarness({ sdk: 'ollama', config: { host: 'http://gpu-box:11434/' } });
    h.reply(openaiChat.reply({ text: '你好' }));
    const message = await h.complete({ system: 'sys', user: 'hi' });
    const req = h.lastRequest();
    expect(req.url).toBe('http://gpu-box:11434/v1/chat/completions');
    expect(req.headers.authorization).toBeUndefined();
    expect(req.body.messages[0]).toEqual({ role: 'system', content: 'sys' });
    expect(message.content).toEqual([{ type: 'text', text: '你好' }]);
  });

  it('assembles streamed tool calls', async () => {
    const h = createProviderHarness({ sdk: 'ollama' });
    h.reply(openaiChat.reply({ toolCalls: [{ name: 'get_weather', arguments: { city: '上海' } }], deltas: 4 }));
    const message = await h.complete({ user: '天气？', tools: [weather] });
    expect(h.lastRequest().url).toBe('http://127.0.0.1:11434/v1/chat/completions');
    expect(message.stopReason).toBe('toolCalls');
    expect(message.content).toEqual([expect.objectContaining({ type: 'toolCall', name: 'get_weather', arguments: { city: '上海' } })]);
  });
});
