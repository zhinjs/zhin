/**
 * Opt-in live smoke test against the real Groq API. Skipped unless GROQ_API_KEY is
 * set; never runs in CI (no key there). Runs one two-step tool loop, the path that
 * failed before the `reasoning_content` → `reasoning` rename.
 *
 *   GROQ_API_KEY=... npx vitest run tests/llm/providers/groq.live.test.ts
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { GROQ_BASE_URL } from '../../../src/llm/groq.js';
import { createLlmApiRuntime } from '../../../src/llm/llm-runtime-factory.js';
import { createUserMessage } from '../../../src/llm/types/agent-message.js';
import type { ProviderInstanceConfig } from '../../../src/llm/types/model.js';

const apiKey = process.env.GROQ_API_KEY?.trim();
const MODEL = process.env.GROQ_MODEL?.trim() || 'openai/gpt-oss-120b';
const weather = { name: 'get_weather', description: 'Weather for one city.', parameters: z.object({ city: z.string() }) };

describe.skipIf(!apiKey)('Groq live smoke (GROQ_API_KEY)', () => {
  it('completes a two-step tool loop', { timeout: 60_000 }, async () => {
    const config: ProviderInstanceConfig = { sdk: 'openai-compatible', baseUrl: GROQ_BASE_URL, apiKey };
    const runtime = createLlmApiRuntime([{ alias: 'groq', config, models: [MODEL], fetch: globalThis.fetch }], () => [MODEL]);
    const model = runtime.model('groq', MODEL);
    const ask = createUserMessage('What is the weather in Paris? Use the get_weather tool, then answer in one sentence.');
    const first = await runtime.complete(model, { systemPrompt: '', messages: [ask], tools: [weather] });
    const call = first.content.find((block) => block.type === 'toolCall');
    expect(call, first.errorMessage).toBeDefined();
    const result = {
      role: 'toolResult' as const, toolCallId: call!.type === 'toolCall' ? call!.id : '', toolName: 'get_weather',
      content: [{ type: 'text' as const, text: 'Sunny, 21°C' }], isError: false, timestamp: Date.now(),
    };
    const second = await runtime.complete(model, { systemPrompt: '', messages: [ask, first, result], tools: [weather] });
    expect(second.stopReason, second.errorMessage).not.toBe('error');
    expect(second.content.some((block) => block.type === 'text' && block.text.trim())).toBe(true);
  });
});
