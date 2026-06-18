import { describe, it, expect, vi } from 'vitest';
import { createSdkProviderAdapter, fetchGoogleModels } from '../src/sdk-provider-adapter.js';

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
});
