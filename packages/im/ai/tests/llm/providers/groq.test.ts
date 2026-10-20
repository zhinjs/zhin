/**
 * Groq behind `sdk: openai-compatible` over a mocked HTTP endpoint (shared provider
 * harness). Wire details follow https://console.groq.com/docs/openai,
 * /docs/reasoning, /docs/rate-limits and a real gpt-oss-120b benchmark.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { GROQ_BASE_URL, groqDefaultModelInput, isGroqGateway, transformGroqRequestBody } from '../../../src/llm/groq.js';
import { applyProviderGatewayPreset, resolveTransportContextWindow, validateProviderGatewayConfig } from '../../../src/llm/provider-gateway-presets.js';
import { createLlmTransportModel } from '../../../src/llm/llm-api-runtime.js';
import { classifyProviderError, type ProviderResilienceEvent } from '../../../src/llm/provider-resilience.js';
import { createUserMessage, type AssistantMessage } from '../../../src/llm/types/agent-message.js';
import type { ProviderInstanceConfig } from '../../../src/llm/types/model.js';
import { createProviderHarness, openaiChat, TEST_API_KEY, type MockResponse } from '../../helpers/provider-harness/index.js';

const GPT_OSS = 'openai/gpt-oss-120b';
const weather = { name: 'get_weather', description: 'Weather for one city.', parameters: z.object({ city: z.string() }) };
const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function groq(model = GPT_OSS, config: Partial<ProviderInstanceConfig> = {}, alias = 'groq') {
  return createProviderHarness({ sdk: 'openai-compatible', alias, model, config: { baseUrl: GROQ_BASE_URL, ...config } });
}

/** Groq streams reasoning in `delta.reasoning` (not `reasoning_content`). */
function groqToolCallStream(reasoning: string): MockResponse {
  const base = { id: 'chatcmpl-groq', object: 'chat.completion.chunk', created: 1_760_000_000, model: GPT_OSS };
  const chunk = (delta: Record<string, unknown>, finish: string | null = null) => ({ data: { ...base, choices: [{ index: 0, delta, finish_reason: finish }] } });
  return {
    sse: [
      chunk({ role: 'assistant', reasoning }),
      chunk({ tool_calls: [{ index: 0, id: 'call_0', type: 'function', function: { name: 'get_weather', arguments: '{"city":"上海"}' } }] }),
      chunk({}, 'tool_calls'),
      { data: '[DONE]' },
    ],
  };
}

const toolResult = { role: 'toolResult' as const, toolCallId: 'call_0', toolName: 'get_weather', content: [{ type: 'text' as const, text: '晴' }], isError: false, timestamp: 1 };

describe('Groq gateway preset', () => {
  it('fills sdk and baseUrl for alias groq and coerces sdk openai on api.groq.com', () => {
    expect(applyProviderGatewayPreset('groq', { apiKey: 'k' } as ProviderInstanceConfig)).toMatchObject({ sdk: 'openai-compatible', baseUrl: GROQ_BASE_URL });
    expect(applyProviderGatewayPreset('groqcloud', { apiKey: 'k' } as ProviderInstanceConfig).baseUrl).toBe(GROQ_BASE_URL);
    expect(applyProviderGatewayPreset('fast', { sdk: 'openai', baseUrl: GROQ_BASE_URL }).sdk).toBe('openai-compatible');
    expect(validateProviderGatewayConfig('fast', { sdk: 'openai', baseUrl: GROQ_BASE_URL })).toEqual([expect.stringContaining('coerced to "openai-compatible"')]);
    // A proxy URL configured explicitly is kept.
    expect(applyProviderGatewayPreset('groq', { sdk: 'openai-compatible', baseUrl: 'https://proxy.test/groq/v1' }).baseUrl).toBe('https://proxy.test/groq/v1');
  });

  it('detects Groq by alias or by host only', () => {
    expect(isGroqGateway('GroqCloud', undefined)).toBe(true);
    expect(isGroqGateway('fast', 'https://api.groq.com/openai/v1')).toBe(true);
    expect(isGroqGateway('fast', 'https://gateway.test/v1?u=api.groq.com')).toBe(false);
    expect(isGroqGateway('openrouter', 'https://openrouter.ai/api/v1')).toBe(false);
  });

  it('preset and request fixes share one detector: exact host api.groq.com, no lookalikes', async () => {
    const groqUrls = ['https://api.groq.com/openai/v1', 'https://API.GROQ.COM/openai/v1', 'https://api.groq.com:443/openai/v1'];
    const lookalikes = [
      'https://api.groq.com.evil.example/openai/v1',
      'https://evil.example/api.groq.com/v1',
      'https://xapi.groq.com/openai/v1',
      'https://gateway.test/v1?u=api.groq.com',
      'not a url api.groq.com',
    ];
    for (const baseUrl of groqUrls) {
      expect(isGroqGateway('fast', baseUrl), baseUrl).toBe(true);
      expect(applyProviderGatewayPreset('fast', { sdk: 'openai', baseUrl }).sdk, baseUrl).toBe('openai-compatible');
    }
    for (const baseUrl of lookalikes) {
      expect(isGroqGateway('fast', baseUrl), baseUrl).toBe(false);
      // The preset no longer matches on a substring, so sdk is left alone.
      expect(applyProviderGatewayPreset('fast', { sdk: 'openai', baseUrl }).sdk, baseUrl).toBe('openai');
    }
    // And no Groq request fix leaks to the lookalike host.
    const evil = groq(GPT_OSS, { baseUrl: 'https://api.groq.com.evil.example/openai/v1' }, 'fast');
    expect((await evil.capture('hi')).body).not.toHaveProperty('reasoning_effort');
  });

  it('takes the context window from the model id (gpt-oss 131072), explicit config first', () => {
    expect(resolveTransportContextWindow({ sdk: 'openai-compatible', baseUrl: GROQ_BASE_URL }, 'openai/gpt-oss-120b')).toBe(131_072);
    expect(resolveTransportContextWindow({ sdk: 'openai-compatible', baseUrl: GROQ_BASE_URL }, 'openai/gpt-oss-20b')).toBe(131_072);
    expect(resolveTransportContextWindow({ sdk: 'openai-compatible', baseUrl: GROQ_BASE_URL, contextWindow: 32_000 }, GPT_OSS)).toBe(32_000);
  });
});

describe('Groq requests', () => {
  it('replays prior reasoning as `reasoning`, never `reasoning_content`, so the tool loop continues', async () => {
    const h = groq().reply(groqToolCallStream('先查天气'), openaiChat.reply({ text: '上海晴' }));
    const first = await h.complete({ user: '上海天气？', tools: [weather] });
    expect(first.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'thinking', thinking: '先查天气' })]));
    const second = await h.complete({ messages: [...h.context({ user: '上海天气？' }).messages, first, toolResult], tools: [weather] });
    expect(second.content).toEqual([expect.objectContaining({ text: '上海晴' })]);
    const assistant = h.lastRequest().body.messages.find((m: { role: string }) => m.role === 'assistant');
    expect(assistant).toMatchObject({ reasoning: '先查天气' });
    expect(assistant).not.toHaveProperty('reasoning_content');
    expect(h.lastRequest().rawBody).not.toContain('reasoning_content');
    expect(h.lastRequest().rawBody).not.toContain(TEST_API_KEY);
  });

  it('defaults GPT-OSS to reasoning_effort low; thinkingLevel overrides it', async () => {
    expect((await groq().capture('hi')).body.reasoning_effort).toBe('low');
    expect((await groq(GPT_OSS, { thinkingLevel: 'high' }).capture('hi')).body.reasoning_effort).toBe('high');
    expect((await groq(GPT_OSS, { thinkingLevel: 'medium' }).capture('hi')).body.reasoning_effort).toBe('medium');
  });

  it('never sends reasoning_effort to models that reject it (Llama)', async () => {
    const { body } = await groq('meta-llama/llama-4-scout-17b-16e-instruct', { thinkingLevel: 'high' }).capture('hi');
    expect(body).not.toHaveProperty('reasoning_effort');
  });

  it('drops logprobs, top_logprobs, logit_bias and n > 1, and keeps accepted fields', () => {
    const out = transformGroqRequestBody({
      model: GPT_OSS, messages: [], logprobs: true, top_logprobs: 3, logit_bias: { 1: 2 }, n: 2,
      user: 'u', seed: 7, temperature: 0, parallel_tool_calls: true, response_format: { type: 'json_schema' },
    });
    expect(out).not.toHaveProperty('logprobs');
    expect(out).not.toHaveProperty('top_logprobs');
    expect(out).not.toHaveProperty('logit_bias');
    expect(out).not.toHaveProperty('n');
    expect(out).toMatchObject({ user: 'u', seed: 7, temperature: 0, parallel_tool_calls: true, response_format: { type: 'json_schema' } });
    expect(transformGroqRequestBody({ model: GPT_OSS, n: 1 }).n).toBe(1);
  });

  it('applies to alias groq behind a proxy URL, but leaves other gateways alone', async () => {
    expect((await groq(GPT_OSS, { baseUrl: 'https://proxy.test/v1' }).capture('hi')).body.reasoning_effort).toBe('low');
    const other = createProviderHarness({ sdk: 'openai-compatible', model: GPT_OSS });
    expect((await other.capture('hi')).body).not.toHaveProperty('reasoning_effort');
  });
});

describe('Groq images', () => {
  it('keeps GPT-OSS text-only and Llama 4 Scout / Maverick image-capable', () => {
    expect(groq().model.input).toEqual(['text']);
    expect(groqDefaultModelInput('openai/gpt-oss-20b')).toEqual(['text']);
    expect(groqDefaultModelInput('meta-llama/llama-4-scout-17b-16e-instruct')).toEqual(['text', 'image']);
    expect(groqDefaultModelInput('meta-llama/llama-4-maverick-17b-128e-instruct')).toEqual(['text', 'image']);
    // Explicit `input` still wins.
    expect(createLlmTransportModel('groq', { sdk: 'openai-compatible', baseUrl: GROQ_BASE_URL, input: ['text', 'image'] }, GPT_OSS).input).toEqual(['text', 'image']);
  });

  it('never sends an image part to GPT-OSS', async () => {
    const image = [{ type: 'image' as const, data: { media: { kind: 'base64' as const, value: PNG_1X1, mime_type: 'image/png' } } }];
    const gptOss = groq();
    const { rawBody } = await gptOss.capture({ messages: [createUserMessage('图里是什么？', image)] });
    expect(rawBody).not.toContain('image_url');
    const scout = groq('meta-llama/llama-4-scout-17b-16e-instruct');
    expect((await scout.capture({ messages: [createUserMessage('图里是什么？', image)] })).rawBody).toContain('image_url');
  });
});

describe('Groq 429s', () => {
  const limit = (window: string) => ({
    message: `Rate limit reached for model \`${GPT_OSS}\` in organization \`org_test\` service tier \`on_demand\` on ${window}: Limit 1000, Used 1000, Requested 1. Please try again in 1m26.4s. Need more tokens? Upgrade to Dev Tier today at https://console.groq.com/settings/billing`,
    type: window.startsWith('tokens') ? 'tokens' : 'requests',
    code: 'rate_limit_exceeded',
  });
  const headers = (retryAfter: string) => ({
    'retry-after': retryAfter,
    'x-ratelimit-limit-requests': '1000', 'x-ratelimit-remaining-requests': '0', 'x-ratelimit-reset-requests': '1m26.4s',
    'x-ratelimit-limit-tokens': '8000', 'x-ratelimit-remaining-tokens': '0', 'x-ratelimit-reset-tokens': '4.1s',
  });

  function run(h: ReturnType<typeof groq>, fallbackIds: string[] = []) {
    const events: ProviderResilienceEvent[] = [];
    const port = h.resilient({
      fallbackModels: fallbackIds.map((id) => createLlmTransportModel(h.alias, h.config, id)),
      sleep: async () => {}, random: () => 0, onEvent: (e) => events.push(e), config: { requestTimeoutMs: 0 },
    });
    return { port, events };
  }

  it('retries a tokens-per-minute 429 after retry-after', async () => {
    const h = groq().reply(openaiChat.error(429, limit('tokens per minute (TPM)'), headers('4')), openaiChat.reply({ text: 'ok' }));
    const { port, events } = run(h);
    const reply: AssistantMessage = await port.complete('hi');
    expect(reply.content).toEqual([expect.objectContaining({ text: 'ok' })]);
    expect(events).toEqual([expect.objectContaining({ type: 'retry', kind: 'rate_limit', delayMs: 4_000 })]);
  });

  it('falls back without retrying when the requests-per-day window is spent', async () => {
    const h = groq().reply(openaiChat.error(429, limit('requests per day (RPD)'), headers('86')), openaiChat.reply({ text: '备用模型' }));
    const { port, events } = run(h, ['openai/gpt-oss-20b']);
    const reply = await port.complete('hi');
    expect(reply.content).toEqual([expect.objectContaining({ text: '备用模型' })]);
    expect(h.requests.map((r) => r.body.model)).toEqual([GPT_OSS, 'openai/gpt-oss-20b']);
    expect(events).toEqual([expect.objectContaining({ type: 'fallback', kind: 'quota_exhausted' })]);
  });

  it('classifies tokens-per-day like requests-per-day', () => {
    const error = Object.assign(new Error(limit('tokens per day (TPD)').message), { statusCode: 429, responseHeaders: headers('300') });
    expect(classifyProviderError(error)).toMatchObject({ kind: 'quota_exhausted', retryable: false, fallbackEligible: true });
  });
});
