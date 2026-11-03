import type { ProviderFixtureConfig } from '../helpers/provider-fixture-config.js';
import { profileModel } from '../helpers/profile-runtime.js';
import { createProfileRuntime } from '../helpers/profile-runtime.js';
/**
 * Gemini behind a pass-through proxy: `baseUrl` (with or without /v1beta, with or
 * without a trailing slash) and optional `headers` reach every endpoint over the
 * real @ai-sdk/google transport: generateContent, streamGenerateContent and the
 * explicit-cache cachedContents create/delete calls. Auth stays the official
 * x-goog-api-key header.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';


import { createUserMessage } from '../../src/llm/types/agent-message.js';
import { googleProvider } from '../../src/providers/api-key.js';


type Call = { url: string; method: string; headers: Headers; body: Record<string, any> };
const SYSTEM = 'You are zhin, a group-chat assistant. '.repeat(400);
const SYSTEM_2 = 'You are zhin v2, a group-chat assistant. '.repeat(400);
const weather = { name: 'get_weather', description: 'Weather for one city.', parameters: z.object({ city: z.string() }) };
const reply = { candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 1, totalTokenCount: 11 } };

function proxy() {
  const calls: Call[] = [];
  let created = 0;
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const request = new Request(input, init), method = request.method;
    const raw = method === 'GET' || method === 'HEAD' ? '' : await request.clone().text();
    calls.push({ url, method, headers: request.headers, body: raw ? JSON.parse(raw) : {} });
    if (url.endsWith('/cachedContents')) return Response.json({ name: `cachedContents/c${++created}` });
    if (method === 'DELETE') return Response.json({});
    if (url.includes('/models?') || url.endsWith('/models')) return Response.json({ models: [{ name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] }] });
    if (url.includes(':streamGenerateContent')) {
      return new Response(`data: ${JSON.stringify(reply)}\r\n\r\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }
    return Response.json(reply);
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

function runtimeFor(srv: ReturnType<typeof proxy>, extra: Partial<ProviderFixtureConfig>) {
  const config: ProviderFixtureConfig = { sdk: 'google', apiKey: 'test-key', ...extra };
  const runtime = createProfileRuntime({ alias: 'gemini', config, models: ['gemini-3.8-flash'], fetch: srv.fetch });
  return { runtime, model: profileModel('gemini', config, 'gemini-3.8-flash') };
}

const ROOT = 'https://gemini-proxy.example.com/google';
const EXPECTED = `${ROOT}/v1beta`;

describe('Gemini baseUrl for a pass-through proxy', () => {
  it.each([ROOT, `${ROOT}/`, `${ROOT}/v1beta`, `${ROOT}/v1beta/`])('sends generateContent to the proxy for baseUrl %s', async (baseUrl) => {
    const srv = proxy();
    const config: ProviderFixtureConfig = { sdk: 'google', apiKey: 'test-key', baseUrl, headers: { 'x-proxy-tag': 'zhin' } };
    const runtime = createProfileRuntime({ alias: 'gemini', config, models: ['gemini-3.8-flash'], fetch: srv.fetch });
    try { await runtime.generate(profileModel('gemini', config, 'gemini-3.8-flash'), { systemPrompt: '', messages: [createUserMessage('hi')] }); } finally { await runtime.dispose(); }
    expect(srv.calls).toHaveLength(1);
    expect(srv.calls[0]!.url).toBe(`${EXPECTED}/models/gemini-3.8-flash:generateContent`);
    expect(srv.calls[0]!.headers.get('x-goog-api-key')).toBe('test-key');
    expect(srv.calls[0]!.headers.get('x-proxy-tag')).toBe('zhin');
  });

  it('streams through the proxy (streamGenerateContent) with the same auth and headers', async () => {
    const srv = proxy();
    const { runtime, model } = runtimeFor(srv, { baseUrl: `${ROOT}/`, headers: { 'x-proxy-tag': 'zhin' } });
    const message = await runtime.complete(model, { systemPrompt: 'hi', messages: [createUserMessage('你好')] });
    expect(message.stopReason).toBe('stop');
    expect(srv.calls).toHaveLength(1);
    expect(srv.calls[0]!.url).toBe(`${EXPECTED}/models/gemini-3.8-flash:streamGenerateContent?alt=sse`);
    expect(srv.calls[0]!.headers.get('x-goog-api-key')).toBe('test-key');
    expect(srv.calls[0]!.headers.get('x-proxy-tag')).toBe('zhin');
  });

  it('creates, uses and deletes explicit cachedContents on the proxy, never on the official host', async () => {
    const srv = proxy();
    const { runtime, model } = runtimeFor(srv, { baseUrl: ROOT, headers: { 'x-proxy-tag': 'zhin' }, contextCache: { mode: 'explicit' } });
    await runtime.complete(model, { systemPrompt: SYSTEM, messages: [createUserMessage('你好')], tools: [weather] });
    // A changed prefix gets a new cache and deletes the old one.
    await runtime.complete(model, { systemPrompt: SYSTEM_2, messages: [createUserMessage('你好')], tools: [weather] });

    const creates = srv.calls.filter((c) => c.url.endsWith('/cachedContents'));
    const deletes = srv.calls.filter((c) => c.method === 'DELETE');
    const generates = srv.calls.filter((c) => c.url.includes('GenerateContent'));
    expect(creates.map((c) => c.url)).toEqual([`${EXPECTED}/cachedContents`, `${EXPECTED}/cachedContents`]);
    expect(deletes.map((c) => c.url)).toEqual([`${EXPECTED}/cachedContents/c1`]);
    expect(generates.map((c) => c.body.cachedContent)).toEqual(['cachedContents/c1', 'cachedContents/c2']);
    for (const call of srv.calls) {
      expect(call.url.startsWith(`${EXPECTED}/`)).toBe(true);
      expect(call.url).not.toContain('generativelanguage.googleapis.com');
      expect(call.headers.get('x-goog-api-key')).toBe('test-key');
      expect(call.headers.get('x-proxy-tag')).toBe('zhin');
    }
  });

  it('lists models through the proxy', async () => {
    const srv = proxy();
    const service = { id: 'service', rootId: 'root', ownerId: 'host', revision: 1, driver: { id: 'google', owner: 'root', contractVersion: '1' }, models: {},
      options: googleProvider.serviceSchema.parse({ baseUrl: `${ROOT}/v1beta/`, headers: { 'x-proxy-tag': 'zhin' } }) };
    const observed = await googleProvider.discover!({ service, credentials: { bindRequest: (input: { request: Request }) => input.request, authorize: async () => ({ token: 'test-key', headers: {}, revision: '1' }) },
      fetch: srv.fetch, signal: new AbortController().signal });
    expect(observed).toContainEqual({ id: 'gemini-3.8-flash' });
    expect(srv.calls[0]!.url).toBe(`${EXPECTED}/models`);
    expect(srv.calls[0]!.headers.get('x-proxy-tag')).toBe('zhin');
  });

  it('defaults to the official host without baseUrl', async () => {
    const srv = proxy();
    const { runtime, model } = runtimeFor(srv, {});
    await runtime.complete(model, { systemPrompt: 'hi', messages: [createUserMessage('你好')] });
    expect(srv.calls[0]!.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse');
  });
});
