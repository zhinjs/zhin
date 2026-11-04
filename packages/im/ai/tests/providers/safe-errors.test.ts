import { inspect } from 'node:util';
import { openAiCompatibleProvider, openAiProvider } from '../../src/providers/api-key.js';
import { driverFixture, callContext, prompt, sse } from './fixtures.js';
import { classifyProviderError } from '../../src/llm/provider-resilience.js';
import { isContextOverflowError } from '../../src/llm/context-overflow.js';
import { ProviderResponseError } from '../../src/llm/provider-error-facts.js';
import { resolveFinish, finishFailureKind } from '../../src/llm/bridge/finish-reason.js';
import { getLogger } from '@zhin.js/logger';

it.each([400, 401, 429, 503])('preserves HTTP %s retry evidence without exposing remote error bodies, callback data or credentials', async status => {
  const secret = 'synthetic-private-credential-callback';
  const fixture = driverFixture({ definition: openAiCompatibleProvider, options: { baseUrl: 'https://provider.example/v1' },
    model: { id: 'selected', protocol: 'openai-chat', kinds: ['language'] }, parameters: { maxRetries: 0 },
    fetch: async () => Response.json({ error: { message: secret, detail: `https://callback.example?code=${secret}` } }, { status, headers: { 'retry-after': '3' } }) });
  const client = await fixture.runtime.openOperation({ context: callContext });
  try {
    const error = await client.generate({ request: { context: prompt } }).catch(error => error);
    expect(error).toMatchObject({ statusCode: status, responseHeaders: status === 429 || status >= 500 ? { 'retry-after-ms': '3000' } : {} });
    expect(`${String(error)}\n${inspect(error)}\n${JSON.stringify(error)}`).not.toContain(secret);
    expect(error).not.toHaveProperty('requestBodyValues'); expect(error).not.toHaveProperty('responseBody'); expect(error).not.toHaveProperty('cause');
  } finally { await client.close(); }
});

it('preserves exhausted SDK retry classification without exposing lastError/errors or provider contents', async () => {
  const fetch = vi.fn(async () => Response.json({ error: { message: 'synthetic-private-response', code: 'server_error' } }, { status: 503, headers: { 'retry-after': '0' } }));
  const fixture = driverFixture({ definition: openAiCompatibleProvider, options: { baseUrl: 'https://provider.example/v1' },
    model: { id: 'selected', kinds: ['language'], protocol: 'openai-chat' }, parameters: { maxRetries: 1 }, fetch });
  const client = await fixture.runtime.openOperation({ context: callContext });
  try {
    const error = await client.generate({ request: { context: prompt } }).catch(error => error);
    expect(fetch).toHaveBeenCalledTimes(2); expect(classifyProviderError(error)).toMatchObject({ kind: 'server', status: 503, retryable: true });
    expect(inspect(error)).not.toContain('synthetic-private'); expect(error).not.toHaveProperty('lastError'); expect(error).not.toHaveProperty('errors');
  } finally { await client.close(); }
});

it.each(['http', 'event'] as const)('keeps real SDK stream %s errors and its early diagnostic hook free of private contents', async mode => {
  const secret = 'synthetic-private-stream-body', consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  const warn = vi.spyOn(getLogger('LLM'), 'warn').mockImplementation(() => {});
  const fixture = driverFixture({ definition: openAiCompatibleProvider, options: { baseUrl: 'https://provider.example/v1' },
    model: { id: 'selected', kinds: ['language'], protocol: 'openai-chat', streaming: true }, parameters: { maxRetries: 0 },
    fetch: async () => mode === 'http' ? Response.json({ error: { message: secret } }, { status: 503 })
      : sse([{ error: { message: secret, type: 'server_error' } }]) });
  const client = await fixture.runtime.openOperation({ context: callContext });
  try {
    const error = await (async () => { const run = await client.stream({ request: { context: prompt } }); for await (const event of run) void event; })().catch(error => error);
    expect(classifyProviderError(error)).toMatchObject({ kind: 'server', retryable: true });
    expect(`${String(error)}${inspect(error)}${inspect(consoleError.mock.calls)}${inspect(warn.mock.calls)}`).not.toContain(secret);
    expect(consoleError).not.toHaveBeenCalled(); expect(warn).toHaveBeenCalled();
  } finally { await client.close(); consoleError.mockRestore(); warn.mockRestore(); }
});

it('retains original context/billing/Google quota facts for resilience and the actual Agent overflow detector', () => {
  for (const raw of [
    { statusCode: 400, message: 'maximum context length synthetic-private' },
    { statusCode: 429, message: 'synthetic-private', data: { error: { code: 'insufficient_quota' } } },
    { statusCode: 429, responseBody: JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED', details: [{ violations: [{ quotaId: 'RequestsPerDay' }] }] } }) },
  ]) {
    const facts = classifyProviderError(raw), safe = new ProviderResponseError(facts);
    expect(classifyProviderError(safe)).toEqual(facts);
    expect(isContextOverflowError(safe)).toBe(isContextOverflowError(raw)); expect(inspect(safe)).not.toContain('synthetic-private');
  }
  expect(isContextOverflowError({ cause: new ProviderResponseError({ kind: 'context_overflow', retryable: false }) })).toBe(true);
});

it('does not copy arbitrary remote finish text into AssistantMessage.errorMessage', () => {
  const secret = 'synthetic-private-finish';
  for (const input of [{ finishReason: 'error', rawFinishReason: secret }, { finishReason: 'content-filter', rawFinishReason: secret },
    { finishReason: 'stop', providerMetadata: { google: { promptFeedback: { blockReason: secret } } } }]) {
    const finish = resolveFinish({ ...input, hasText: false, hasToolCalls: false });
    expect(finish.errorMessage).not.toContain(secret); expect(finishFailureKind(finish.errorMessage)).toBeDefined();
  }
});

it.each(['invalid-json', 'invalid-schema'] as const)('keeps malformed 200 language %s diagnostics free of remote content', async mode => {
  const secret = 'synthetic-private-malformed-success';
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  const fixture = driverFixture({ definition: openAiCompatibleProvider, options: { baseUrl: 'https://provider.example/v1' },
    model: { id: 'selected', protocol: 'openai-chat', kinds: ['language'] }, parameters: { maxRetries: 0 },
    fetch: async () => mode === 'invalid-json' ? new Response(secret, { headers: { 'content-type': 'application/json' } })
      : Response.json({ invalid: secret }) });
  const client = await fixture.runtime.openOperation({ context: callContext });
  try {
    const error = await client.generate({ request: { context: prompt } }).catch(error => error);
    expect(error).toBeInstanceOf(Error);
    expect(`${String(error)}${inspect(error)}${JSON.stringify(error)}${inspect(consoleError.mock.calls)}`).not.toContain(secret);
  } finally { await client.close(); consoleError.mockRestore(); }
});


it.each(['invalid-json', 'invalid-schema', 'missing-images'] as const)('keeps malformed 200 image %s diagnostics free of remote image payloads', async mode => {
  const secret = 'synthetic-private-image-payload';
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  const fixture = driverFixture({ definition: openAiProvider, model: { id: 'gpt-image-1', protocol: 'openai-images', kinds: ['image'] }, parameters: { maxRetries: 0 },
    fetch: async () => mode === 'invalid-json' ? new Response(secret, { headers: { 'content-type': 'application/json' } })
      : mode === 'invalid-schema' ? Response.json({ data: [{ b64_json: { private: secret } }] }) : Response.json({ data: [], extra: secret }) });
  const client = await fixture.runtime.openOperation({ context: callContext });
  try {
    const error = await client.generateImage({ request: { prompt: 'synthetic image' } }).catch(error => error);
    expect(error).toBeInstanceOf(Error);
    expect(`${String(error)}${inspect(error)}${JSON.stringify(error)}${inspect(consoleError.mock.calls)}`).not.toContain(secret);
  } finally { await client.close(); consoleError.mockRestore(); }
});
