/**
 * Gemini cachedContents request shape (ai.google.dev/api/caching) and failure handling.
 * No network: the base fetch is a recorder.
 */
import { describe, expect, it, vi } from 'vitest';
import { getLogger } from '@zhin.js/logger';
import { createGeminiCachingFetch } from '../../src/llm/gemini-context-cache.js';

const ROOT = 'https://generativelanguage.googleapis.com/v1beta';
const GENERATE = `${ROOT}/models/gemini-3.8-flash:streamGenerateContent?alt=sse`;
const STABLE = { text: 'stable rules '.repeat(900) };
const SCENE = { text: '[scene_id:g1;scene_type:group;]' };
const TOOLS = [{ functionDeclarations: [{ name: 'get_weather', description: 'w', parameters: { type: 'object' } }] }];

function recorder(createResponse: () => Response) {
  const calls: Array<{ url: string; method: string; body: Record<string, any> }> = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : {} });
    if (url.endsWith('/cachedContents')) return createResponse();
    return Response.json({ candidates: [] });
  }) as typeof globalThis.fetch;
  return { calls, fetch };
}

const generate = (fetch: typeof globalThis.fetch, scene = SCENE) => fetch(GENERATE, {
  method: 'POST',
  headers: { 'x-goog-api-key': 'k' },
  body: JSON.stringify({
    systemInstruction: { parts: [STABLE, scene] },
    tools: TOOLS,
    contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
  }),
});

describe('Gemini explicit cache request', () => {
  it('creates POST {root}/cachedContents caching only the stable system part and tools', async () => {
    const { calls, fetch } = recorder(() => Response.json({ name: 'cachedContents/c1' }));
    await generate(createGeminiCachingFetch({ mode: 'explicit' }, fetch));
    const [create, send] = calls;
    expect(create!.url).toBe(`${ROOT}/cachedContents`);
    expect(create!.method).toBe('POST');
    expect(create!.body).toEqual({
      model: 'models/gemini-3.8-flash',
      systemInstruction: { parts: [STABLE] },
      tools: TOOLS,
      ttl: '600s',
    });
    // The scene tail moves into contents; the prefix fields are replaced by cachedContent.
    expect(send!.body.cachedContent).toBe('cachedContents/c1');
    expect(send!.body.systemInstruction).toBeUndefined();
    expect(send!.body.tools).toBeUndefined();
    expect(send!.body.contents[0]).toEqual({ role: 'user', parts: [SCENE] });
    expect(send!.body.contents[1]).toEqual({ role: 'user', parts: [{ text: 'hi' }] });
  });

  it('reuses one cache across scenes (scene tail does not change the key)', async () => {
    const { calls, fetch } = recorder(() => Response.json({ name: 'cachedContents/c1' }));
    const caching = createGeminiCachingFetch({ mode: 'explicit' }, fetch);
    await generate(caching, { text: 'scene A' });
    await generate(caching, { text: 'scene B' });
    expect(calls.filter(c => c.url.endsWith('/cachedContents'))).toHaveLength(1);
    expect(caching.stats).toMatchObject({ created: 1, reused: 1 });
  });

  it('a 404 on create marks the model unsupported: one log, one attempt, implicit fallback', async () => {
    const warn = vi.spyOn(getLogger('ai-context-cache'), 'warn').mockImplementation(() => undefined);
    const { calls, fetch } = recorder(() => Response.json(
      { error: { code: 404, message: 'models/gemini-3.8-flash is not found for API version v1beta, or is not supported for createCachedContent.', status: 'NOT_FOUND' } },
      { status: 404 },
    ));
    const caching = createGeminiCachingFetch({ mode: 'explicit' }, fetch);
    await generate(caching);
    await generate(caching, { text: 'other scene' });
    expect(calls.filter(c => c.url.endsWith('/cachedContents'))).toHaveLength(1);
    // The original request goes out unchanged.
    const sent = calls.filter(c => !c.url.endsWith('/cachedContents'));
    expect(sent[0]!.body.systemInstruction).toEqual({ parts: [STABLE, SCENE] });
    expect(sent[0]!.body.cachedContent).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('not supported for createCachedContent');
    warn.mockRestore();
  });
});
