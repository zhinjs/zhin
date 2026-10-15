/**
 * Explicit Gemini context caching over the real @ai-sdk/google transport with a
 * mocked HTTP endpoint (#769): create once, reuse on the second turn, TTL refresh,
 * invalidation on prefix change and on a server-side miss, implicit fallback.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createLlmApiRuntime } from '../../src/llm/llm-runtime-factory.js';
import { createLlmTransportModel } from '../../src/llm/llm-api-runtime.js';
import { createUserMessage } from '../../src/llm/types/agent-message.js';
import { createGeminiCachingFetch } from '../../src/llm/gemini-context-cache.js';
import type { ProviderInstanceConfig } from '../../src/llm/types/model.js';

type Call = { url: string; method: string; body: Record<string, any>; keyed: boolean };
const SYSTEM = 'You are zhin, a group-chat assistant. '.repeat(400);
const weather = { name: 'get_weather', description: 'Weather for one city.', parameters: z.object({ city: z.string() }) };

function server(options: { createStatus?: number; generateStatus?: (call: Call) => number } = {}) {
  const calls: Call[] = [];
  let created = 0;
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const call = { url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : {}, keyed: new Headers(init?.headers).has('x-goog-api-key') };
    calls.push(call);
    if (url.endsWith('/cachedContents')) {
      if (options.createStatus && options.createStatus !== 200) return new Response('{"error":{"code":400,"status":"INVALID_ARGUMENT"}}', { status: options.createStatus });
      created += 1;
      return Response.json({ name: `cachedContents/c${created}` });
    }
    if (call.method === 'DELETE') return Response.json({});
    const status = options.generateStatus?.(call) ?? 200;
    if (status !== 200) return new Response('{"error":{"code":404,"status":"NOT_FOUND"}}', { status });
    const cached = call.body.cachedContent ? 4000 : 0;
    const payload = {
      candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 4200, candidatesTokenCount: 1, totalTokenCount: 4201, ...(cached ? { cachedContentTokenCount: cached } : {}) },
    };
    return new Response(`data: ${JSON.stringify(payload)}\r\n\r\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

function setup(srv: ReturnType<typeof server>, extra: Partial<ProviderInstanceConfig> = {}) {
  const config: ProviderInstanceConfig = { sdk: 'google', apiKey: 'test-key', contextCache: { mode: 'explicit' }, ...extra };
  const runtime = createLlmApiRuntime([{ alias: 'gemini', config, models: ['gemini-3.8-flash'], fetch: srv.fetch }], () => ['gemini-3.8-flash']);
  return { runtime, model: createLlmTransportModel('gemini', config, 'gemini-3.8-flash') };
}

const generates = (calls: Call[]) => calls.filter((c) => /GenerateContent/.test(c.url) && !c.url.includes('cachedContents'));
const creates = (calls: Call[]) => calls.filter((c) => c.url.endsWith('/cachedContents'));

describe('Gemini explicit context caching', () => {
  it('creates one cache for the system + tools prefix and reuses it on the second turn', async () => {
    const srv = server();
    const { runtime, model } = setup(srv);
    const first = await runtime.complete(model, { systemPrompt: SYSTEM, messages: [createUserMessage('你好')], tools: [weather] });
    const second = await runtime.complete(model, { systemPrompt: SYSTEM, messages: [createUserMessage('你好'), first, createUserMessage('再说一次')], tools: [weather] });

    expect(creates(srv.calls)).toHaveLength(1);
    const create = creates(srv.calls)[0]!.body;
    expect(create).toMatchObject({ model: 'models/gemini-3.8-flash', ttl: '600s' });
    expect(create.systemInstruction.parts[0].text).toContain('You are zhin');
    expect(create.tools[0].functionDeclarations[0].name).toBe('get_weather');
    for (const call of generates(srv.calls)) {
      expect(call.body.cachedContent).toBe('cachedContents/c1');
      expect(call.body.systemInstruction).toBeUndefined();
      expect(call.body.tools).toBeUndefined();
    }
    expect(creates(srv.calls)[0]!.url).toBe('https://generativelanguage.googleapis.com/v1beta/cachedContents');
    expect(creates(srv.calls)[0]!.keyed).toBe(true); // authenticated with the provider's own headers
    expect(JSON.stringify(srv.calls)).not.toContain('test-key');
    expect(second.usage.cacheRead).toBe(4000);
  });

  it('re-creates the cache when the TTL is about to run out', async () => {
    const srv = server();
    let clock = 0;
    const cachingFetch = createGeminiCachingFetch({ mode: 'explicit', ttlSeconds: 120 }, srv.fetch, () => clock);
    const body = JSON.stringify({ systemInstruction: { parts: [{ text: SYSTEM }] }, contents: [] });
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent';
    await cachingFetch(url, { method: 'POST', body });
    clock = 60_000;
    await cachingFetch(url, { method: 'POST', body });
    clock = 100_000; // 20 s left, inside the refresh margin
    await cachingFetch(url, { method: 'POST', body });
    expect(cachingFetch.stats).toMatchObject({ created: 2, reused: 1 });
    expect(creates(srv.calls)[0]!.url).toBe('https://generativelanguage.googleapis.com/v1beta/cachedContents');
  });

  it('deletes the old cache and makes a new one when the prefix changes', async () => {
    const srv = server();
    const { runtime, model } = setup(srv);
    await runtime.complete(model, { systemPrompt: SYSTEM, messages: [createUserMessage('a')], tools: [weather] });
    await runtime.complete(model, { systemPrompt: `${SYSTEM} 新规则。`, messages: [createUserMessage('b')], tools: [weather] });
    expect(creates(srv.calls)).toHaveLength(2);
    expect(srv.calls.filter((c) => c.method === 'DELETE').map((c) => c.url)).toEqual([expect.stringMatching(/\/cachedContents\/c1$/)]);
    expect(generates(srv.calls).at(-1)!.body.cachedContent).toBe('cachedContents/c2');
  });

  it('falls back to the full request when the server no longer has the cache', async () => {
    const srv = server({ generateStatus: (call) => (call.body.cachedContent ? 404 : 200) });
    const { runtime, model } = setup(srv);
    const message = await runtime.complete(model, { systemPrompt: SYSTEM, messages: [createUserMessage('a')], tools: [weather] });
    expect(message.stopReason).toBe('stop');
    const last = generates(srv.calls).at(-1)!.body;
    expect(last.cachedContent).toBeUndefined();
    expect(last.systemInstruction).toBeDefined();
  });

  it('leaves requests unchanged (implicit caching) when the cache cannot be created, and does not retry each turn', async () => {
    const srv = server({ createStatus: 400 });
    const { runtime, model } = setup(srv);
    await runtime.complete(model, { systemPrompt: SYSTEM, messages: [createUserMessage('a')], tools: [weather] });
    await runtime.complete(model, { systemPrompt: SYSTEM, messages: [createUserMessage('b')], tools: [weather] });
    expect(creates(srv.calls)).toHaveLength(1);
    for (const call of generates(srv.calls)) expect(call.body.systemInstruction).toBeDefined();
  });

  it('skips short prefixes and is off unless mode is explicit', async () => {
    const srv = server();
    const { runtime, model } = setup(srv);
    await runtime.complete(model, { systemPrompt: 'short', messages: [createUserMessage('a')] });
    const implicit = setup(srv, { contextCache: undefined });
    await implicit.runtime.complete(implicit.model, { systemPrompt: SYSTEM, messages: [createUserMessage('a')] });
    expect(creates(srv.calls)).toHaveLength(0);
  });
});
