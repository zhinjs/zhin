import { openAiCompatibleProvider, openAiProvider, googleProvider, miniMaxProvider, cloudflareProvider } from '../../src/providers/api-key.js';
import { callContext, chatReply, driverFixture, prompt, sse } from './fixtures.js';

describe('real installed SDK Provider requests (offline transport)', () => {
  it.each([
    { definition: miniMaxProvider, options: { baseUrl: 'https://private-gateway.example/anthropic/v1' }, model: { id: 'image-01', kinds: ['image'] as const, protocol: 'minimax-images' } },
    { definition: cloudflareProvider, options: { accountId: 'synthetic-account', baseUrl: 'https://private-gateway.example/v1' }, model: { id: '@cf/flux', kinds: ['image'] as const, protocol: 'cloudflare-images' } },
  ])('never forwards a custom $definition.id gateway credential to the native image product', async ({ definition, options, model }) => {
    const fetch = vi.fn(async () => { throw new Error('No transport expected'); });
    const fixture = driverFixture({ definition, options, model, fetch });
    const client = await fixture.runtime.openOperation({ context: callContext });
    await expect(client.generateImage({ request: { prompt: 'private synthetic prompt' } })).rejects.toThrow('unsupported-capability');
    expect(fetch).not.toHaveBeenCalled(); expect(fixture.authorize).not.toHaveBeenCalled();
    const service = { ...fixture.graph.services.service, options: definition.serviceSchema.parse(options) };
    expect(definition.targets(service).inference.every(value => new URL(value).origin === 'https://private-gateway.example')).toBe(true);
    await client.close();
  });
  it('supports non-stream generation without secretly requesting SSE and rejects unsupported streaming before HTTP', async () => {
    const requests: Request[] = [];
    const fixture = driverFixture({ definition: openAiCompatibleProvider,
      options: { baseUrl: 'https://gateway.example', compat: { appendV1: true, includeUsage: false } },
      model: { id: 'configured-model', kinds: ['language'], protocol: 'openai-chat', streaming: false, contextWindow: 32000, maxOutputTokens: 111 },
      parameters: { temperature: 0.25, maxOutputTokens: 77, maxRetries: 0 },
      fetch: async (url, init) => { requests.push(new Request(url, init)); return chatReply(); },
    });
    const client = await fixture.runtime.openOperation({ context: callContext });
    const result = await client.generate({ request: { context: prompt } });
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe('https://gateway.example/v1/chat/completions');
    expect(requests[0].headers.get('authorization')).toBe('Bearer synthetic-key');
    const body = await requests[0].json();
    expect(body).toMatchObject({ model: 'configured-model', temperature: 0.25, max_tokens: 77 });
    expect(body.stream).not.toBe(true);
    expect(result.content).toEqual([{ type: 'text', text: 'synthetic answer' }]);
    expect(result.usage.totalTokens).toBe(15);
    await expect(client.stream({ request: { context: prompt } })).rejects.toThrow('unsupported-capability');
    expect(requests).toHaveLength(1);
    await client.close();
  });

  it.each([true, false])('preserves includeUsage=$value on actual streaming requests and creates no HTTP before consumption', async includeUsage => {
    const requests: Request[] = [];
    const fixture = driverFixture({ definition: openAiCompatibleProvider, options: { baseUrl: 'https://gateway.example/custom', compat: { appendV1: false, includeUsage } },
      model: { id: 'configured-model', kinds: ['language'], protocol: 'openai-chat', streaming: true },
      parameters: { maxRetries: 0 },
      fetch: async (url, init) => { requests.push(new Request(url, init)); return sse([
        { id: 'chatcmpl-local', created: 1, model: 'configured-model', choices: [{ index: 0, delta: { content: 'hello' }, finish_reason: null }] },
        { id: 'chatcmpl-local', created: 1, model: 'configured-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } },
      ]); },
    });
    const client = await fixture.runtime.openOperation({ context: callContext });
    const run = await client.stream({ request: { context: prompt } });
    expect(requests).toHaveLength(0);
    for await (const event of run) if (event.type === 'done') expect(event.message?.usage.totalTokens).toBe(3);
    const body = await requests[0].json();
    expect(body.stream_options).toEqual(includeUsage ? { include_usage: true } : undefined);
    expect(requests[0].url).toBe('https://gateway.example/custom/chat/completions');
    await client.close();
  });

  it('bounds pending response headers with the configured first-chunk budget and propagates the abort without replay', async () => {
    const requests: Request[] = [];
    let aborted = 0;
    const fixture = driverFixture({ definition: openAiCompatibleProvider, options: { baseUrl: 'https://gateway.example/v1' },
      model: { id: 'configured-model', kinds: ['language'], protocol: 'openai-chat', streaming: true },
      parameters: { maxRetries: 0, firstChunkTimeoutMs: 15 }, fetch: async (_url, init) => {
        const request = new Request(_url, init);
        requests.push(request);
        const signal = request.signal;
        return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener('abort', () => { aborted++; reject(signal.reason); }, { once: true });
        });
      },
    });
    const client = await fixture.runtime.openOperation({ context: callContext });
    await expect(client.generate({ request: { context: prompt } })).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(requests).toHaveLength(1); expect(aborted).toBe(1);
    expect(requests[0].signal.aborted).toBe(true); expect(requests[0].signal.reason).toMatchObject({ name: 'TimeoutError' });
    await client.close();
  });

  it('applies OpenAI image profile defaults and provider options to the real image wire request', async () => {
    const requests: Request[] = [];
    const fixture = driverFixture({ definition: openAiProvider,
      model: { id: 'gpt-image-1', kinds: ['image'], protocol: 'openai-images' },
      parameters: { maxRetries: 0, imageGeneration: { defaultSize: '1024x1024', quality: 'high', background: 'transparent', promptSuffix: 'watercolor' } },
      fetch: async (url, init) => { requests.push(new Request(url, init)); return Response.json({ created: 1, data: [{ b64_json: 'aW1hZ2U=' }] }); },
    });
    const client = await fixture.runtime.openOperation({ context: callContext });
    expect((await client.generateImage({ request: { prompt: 'A tree' } })).base64).toBe('aW1hZ2U=');
    expect(await requests[0].json()).toMatchObject({ model: 'gpt-image-1', prompt: 'A tree\nwatercolor', size: '1024x1024', quality: 'high', background: 'transparent' });
    await client.close();
  });

  it('reuses the actual Gemini explicit-cache directory across executions without storing call credentials in that directory', async () => {
    const requests: { url: string; body?: unknown; key: string | null }[] = [];
    const fixture = driverFixture({ definition: googleProvider, options: { contextCache: { mode: 'explicit', minPrefixChars: 1, ttlSeconds: 3600 } },
      model: { id: 'gemini-local', kinds: ['language'], protocol: 'google-generate-content' },
      parameters: { maxRetries: 0 },
      fetch: async (url, init) => {
        const request = new Request(url, init);
        requests.push({ url: request.url, body: request.method === 'POST' ? await request.json() : undefined, key: request.headers.get('x-goog-api-key') });
        if (request.url.endsWith('/cachedContents')) return Response.json({ name: 'cachedContents/local', expireTime: new Date(Date.now() + 3600000).toISOString() });
        return Response.json({ candidates: [{ content: { role: 'model', parts: [{ text: 'hello' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 1, totalTokenCount: 6, cachedContentTokenCount: 4 } });
      },
    });
    const client = await fixture.runtime.openOperation({ context: callContext });
    for (let i = 0; i < 2; i++) await client.generate({ request: { context: prompt } });
    expect(requests.filter(item => item.url.endsWith('/cachedContents'))).toHaveLength(1);
    expect(requests.filter(item => item.url.includes(':generateContent')).every(item => JSON.stringify(item.body).includes('cachedContents/local'))).toBe(true);
    expect(requests.every(item => item.key === 'synthetic-key')).toBe(true);
    expect(fixture.authorize.mock.calls.length).toBeGreaterThanOrEqual(5);
    await client.close();
  });

  it.each([
    { definition: miniMaxProvider, options: {}, model: { id: 'image-01', kinds: ['image'] as const, protocol: 'minimax-images' },
      parameters: { imageGeneration: { defaultSize: '1024x1024', aspectRatio: '1:1' } }, endpoint: 'https://api.minimaxi.com/v1/image_generation',
      expected: { model: 'image-01', response_format: 'base64', width: 1024, height: 1024, aspect_ratio: '1:1' },
      response: () => Response.json({ data: { image_base64: ['aW1hZ2U='] }, base_resp: { status_code: 0 } }) },
    { definition: cloudflareProvider, options: { accountId: 'synthetic-account' }, model: { id: '@cf/flux', kinds: ['image'] as const, protocol: 'cloudflare-images' },
      parameters: { imageGeneration: { numSteps: 6 } }, endpoint: 'https://api.cloudflare.com/client/v4/accounts/synthetic-account/ai/run/@cf/flux',
      expected: { num_steps: 6 }, response: () => Response.json({ success: true, result: { image: 'aW1hZ2U=' } }) },
  ])('retains the existing $definition.id REST image protocol and defaults without an SDK placeholder', async ({ definition, options, model, parameters, endpoint, expected, response }) => {
    const requests: Request[] = [];
    const fixture = driverFixture({ definition, options, model, parameters,
      fetch: async (url, init) => { requests.push(new Request(url, init)); return response(); } });
    const client = await fixture.runtime.openOperation({ context: callContext });
    expect((await client.generateImage({ request: { prompt: 'synthetic' } })).base64).toBe('aW1hZ2U=');
    expect(requests[0].url).toBe(endpoint); expect(await requests[0].json()).toMatchObject(expected);
    expect(requests[0].headers.get('authorization')).toBe('Bearer synthetic-key'); await client.close();
  });

  it('forwards compatible image watermark and quality through the actual SDK namespace', async () => {
    const requests: Request[] = [];
    const fixture = driverFixture({ definition: openAiCompatibleProvider, options: { baseUrl: 'https://images.example/v1' },
      model: { id: 'cogview-local', kinds: ['image'], protocol: 'openai-images' }, parameters: { maxRetries: 0, imageGeneration: { watermarkEnabled: false, quality: 'high' } },
      fetch: async (url, init) => { requests.push(new Request(url, init)); return Response.json({ created: 1, data: [{ b64_json: 'aW1hZ2U=' }] }); } });
    const client = await fixture.runtime.openOperation({ context: callContext }); await client.generateImage({ request: { prompt: 'synthetic' } });
    expect(await requests[0].json()).toMatchObject({ watermark_enabled: false, quality: 'high' }); await client.close();
  });

  it('uses the supported Google imageConfig instead of silently discarding size/aspect defaults', async () => {
    const requests: Request[] = [];
    const fixture = driverFixture({ definition: googleProvider,
      model: { id: 'gemini-2.5-flash-image', kinds: ['image'], protocol: 'google-images' }, parameters: { maxRetries: 0, imageGeneration: { imageSize: '2K', aspectRatio: '16:9' } },
      fetch: async (url, init) => { requests.push(new Request(url, init)); return Response.json({ candidates: [{ content: { role: 'model', parts: [{ inlineData: { mimeType: 'image/png', data: 'aW1hZ2U=' } }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 1, totalTokenCount: 4 } }); } });
    const client = await fixture.runtime.openOperation({ context: callContext }); await client.generateImage({ request: { prompt: 'synthetic' } });
    expect(await requests[0].json()).toMatchObject({ generationConfig: { imageConfig: { imageSize: '2K', aspectRatio: '16:9' } } }); await client.close();
  });
});

it('keeps the caller cancellation of a bound native REST image Request while response headers have a separate budget', async () => {
  const requests: Request[] = [];
  let submitted = 0, aborted = 0;
  const fixture = driverFixture({ definition: miniMaxProvider,
    model: { id: 'image-01', kinds: ['image'], protocol: 'minimax-images' }, parameters: { maxRetries: 0, firstChunkTimeoutMs: 1000 },
    fetch: async (input, init) => { submitted++; const request = new Request(input, init); requests.push(request);
      return new Promise<Response>((_resolve, reject) => request.signal.addEventListener('abort', () => { aborted++; reject(request.signal.reason); }, { once: true })); } });
  const client = await fixture.runtime.openOperation({ context: callContext }), controller = new AbortController(), reason = new Error('caller stopped synthetic image');
  const result = client.generateImage({ request: { prompt: 'synthetic image' }, signal: controller.signal });
  await vi.waitFor(() => expect(submitted).toBe(1)); controller.abort(reason);
  await expect(result).rejects.toBe(reason); expect(submitted).toBe(1); expect(aborted).toBe(1);
  expect(requests).toHaveLength(1); expect(requests[0].signal.aborted).toBe(true); expect(requests[0].signal.reason).toBe(reason);
  await client.close();
});


it('binds only the actual final Request to its fresh grant, without mistaking the SDK construction grant for use', async () => {
  const requests: Request[] = [];
  const fixture = driverFixture({ definition: openAiCompatibleProvider, options: { baseUrl: 'https://provider.example/v1' },
    model: { id: 'selected', protocol: 'openai-chat', kinds: ['language'] }, parameters: { maxRetries: 0 },
    fetch: async input => { if (!(input instanceof Request)) throw new Error('Expected final bound Request'); requests.push(input); return chatReply(); } });
  const initial = { token: 'synthetic-initial', headers: {}, revision: 'old' }, fresh = { token: 'synthetic-current', headers: {}, revision: 'current' };
  fixture.authorize.mockResolvedValueOnce(initial).mockResolvedValueOnce(fresh);
  const client = await fixture.runtime.openOperation({ context: callContext });
  try {
    await client.generate({ request: { context: prompt } });
    expect(fixture.authorize).toHaveBeenCalledTimes(2); expect(fixture.bindRequest).toHaveBeenCalledOnce();
    expect(fixture.bindRequest.mock.calls[0][0].grant).toBe(fresh); expect(fixture.bindRequest.mock.calls[0][0].request).toBe(requests[0]);
    expect(requests[0].headers.get('authorization')).toBe('Bearer synthetic-current');
  } finally { await client.close(); }
});

it('keeps an omitted Profile budget dynamic after a native model change while the old operation retains its declared cap', async () => {
  const requests: Request[] = [];
  const fixture = driverFixture({ definition: openAiCompatibleProvider, options: { baseUrl: 'https://provider.example/v1' },
    model: { id: 'first', kinds: ['language'], protocol: 'openai-chat', maxOutputTokens: 22 }, parameters: { maxRetries: 0 },
    fetch: async (url, init) => { requests.push(new Request(url, init)); return chatReply(); } });
  const old = await fixture.runtime.openOperation({ context: callContext }), graph = fixture.graph;
  fixture.replaceGraph({ ...graph, revision: 2, services: { service: { ...graph.services.service, revision: 2, models: { ...graph.services.service.models,
    next: { id: 'next', kinds: ['language'], protocol: 'openai-chat', maxOutputTokens: 33 } } } },
    profiles: { selected: { ...graph.profiles.selected, model: 'next', revision: 2 } } });
  const next = await fixture.runtime.openOperation({ context: { ...callContext, operationId: 'next' } });
  try {
    await old.generate({ request: { context: prompt } }); await next.generate({ request: { context: prompt } });
    expect(await requests[0].json()).toMatchObject({ model: 'first', max_tokens: 22 });
    expect(await requests[1].json()).toMatchObject({ model: 'next', max_tokens: 33 });
    expect(graph.profiles.selected.parameters).not.toHaveProperty('maxOutputTokens');
  } finally { await old.close(); await next.close(); }
});
