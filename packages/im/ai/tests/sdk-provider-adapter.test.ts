import { describe, it, expect, vi, afterEach } from 'vitest';
import { AiHttpTransport } from '../src/llm/http-transport.js';
import { createSdkProviderAdapter, fetchGoogleModels } from '../src/sdk-provider-adapter.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('SdkProviderAdapter models', () => {
  it('anthropic adapter gets preset models without yaml', () => {
    const p = createSdkProviderAdapter('anyrouter', {
      sdk: 'anthropic',
      apiKey: 'test-key',
      baseUrl: 'https://anyrouter.top',
    });
    expect(p).not.toBeNull();
    expect(p!.models.length).toBeGreaterThan(0);
    expect(p!.models).toContain('claude-sonnet-4-6');
  });

  it('anthropic adapter uses custom yaml models', async () => {
    const p = createSdkProviderAdapter('anyrouter', {
      sdk: 'anthropic',
      apiKey: 'test-key',
      baseUrl: 'https://anyrouter.top',
      models: ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
    });
    expect(p!.models).toEqual([
      'claude-sonnet-4-6',
      'claude-haiku-4-5-20251001',
    ]);
    await expect(p!.listModels()).resolves.toEqual(p!.models);
  });

  it('google listModels calls GET /v1beta/models when yaml models omitted', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain('/v1beta/models');
      return {
        ok: true,
        json: async () => ({
          models: [
            { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
          ],
        }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const p = createSdkProviderAdapter('gemini', {
      sdk: 'google',
      apiKey: 'test-key',
      baseUrl: 'https://proxy.example',
    });
    await expect(p!.listModels()).resolves.toEqual(['gemini-2.5-flash']);
    expect(fetchMock).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('google listModels skips discovery when yaml models set', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const p = createSdkProviderAdapter('gemini', {
      sdk: 'google',
      apiKey: 'test-key',
      models: ['gemini-2.5-flash'],
    });
    await expect(p!.listModels()).resolves.toEqual(['gemini-2.5-flash']);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('fetchGoogleModels strips models/ prefix', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        models: [{ name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] }],
      }),
    })));
    await expect(fetchGoogleModels({
      sdk: 'google',
      apiKey: 'k',
      baseUrl: 'https://proxy.example',
    })).resolves.toEqual(['gemini-2.5-pro']);
    vi.unstubAllGlobals();
  });

  it('keeps model discovery transport isolated between provider owners', async () => {
    const leftFetch = vi.fn(async () => new Response(JSON.stringify({
      data: [{ id: 'left-model' }],
    })));
    const rightFetch = vi.fn(async () => new Response(JSON.stringify({
      data: [{ id: 'right-model' }],
    })));
    const left = createSdkProviderAdapter('left', {
      sdk: 'openai-compatible',
      apiKey: 'left-key',
      baseUrl: 'https://left.example/v1',
    }, new AiHttpTransport({ fetch: leftFetch as typeof fetch }));
    const right = createSdkProviderAdapter('right', {
      sdk: 'openai-compatible',
      apiKey: 'right-key',
      baseUrl: 'https://right.example/v1',
    }, new AiHttpTransport({ fetch: rightFetch as typeof fetch }));

    await expect(left!.listModels()).resolves.toEqual(['left-model']);
    await expect(right!.listModels()).resolves.toEqual(['right-model']);
    expect(leftFetch).toHaveBeenCalledWith('https://left.example/v1/models', expect.anything());
    expect(rightFetch).toHaveBeenCalledWith('https://right.example/v1/models', expect.anything());

    await Promise.all([left!.dispose(), right!.dispose()]);
  });
});
