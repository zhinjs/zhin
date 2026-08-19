/**
 * MiniMax image generation (direct REST bridge) tests.
 */

import { generateMiniMaxImage } from '../../src/llm/minimax-image.js';
import type { ProviderInstanceConfig } from '../../src/llm/types/model.js';

function mockConfig(overrides: Partial<ProviderInstanceConfig> = {}): ProviderInstanceConfig {
  return {
    sdk: 'minimax',
    apiKey: 'test-key-123',
    ...overrides,
  } as ProviderInstanceConfig;
}

describe('generateMiniMaxImage', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('throws when apiKey is missing', async () => {
    await expect(
      generateMiniMaxImage(mockConfig({ apiKey: '' }), { prompt: 'a cat' }),
    ).rejects.toThrow('requires apiKey');
  });

  it('throws when prompt is empty', async () => {
    await expect(
      generateMiniMaxImage(mockConfig(), { prompt: '' }),
    ).rejects.toThrow('requires prompt');
  });

  it('sends correct request to MiniMax API and returns base64', async () => {
    let capturedUrl = '';
    let capturedBody: Record<string, unknown> = {};
    let capturedHeaders: Record<string, string> = {};

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      capturedUrl = typeof input === 'string' ? input : (input as URL).toString();
      capturedBody = JSON.parse(init?.body as string);
      capturedHeaders = init?.headers as Record<string, string>;
      return new Response(JSON.stringify({
        data: { image_base64: ['aW1hZ2VkYXRh'] },
        base_resp: { status_code: 0, status_msg: 'success' },
      }), { status: 200 });
    }) as typeof fetch;

    const result = await generateMiniMaxImage(
      mockConfig(),
      { prompt: 'a cute cat', aspectRatio: '16:9' },
      { defaultModel: 'image-01' },
    );

    expect(capturedUrl).toBe('https://api.minimaxi.com/v1/image_generation');
    expect(capturedBody.model).toBe('image-01');
    expect(capturedBody.prompt).toBe('a cute cat');
    expect(capturedBody.response_format).toBe('base64');
    expect(capturedBody.aspect_ratio).toBe('16:9');
    expect(capturedHeaders.Authorization).toBe('Bearer test-key-123');

    expect(result.base64).toBe('aW1hZ2VkYXRh');
    expect(result.mimeType).toBe('image/png');
    expect(result.model).toBe('image-01');
  });

  it('always uses fixed API URL regardless of config.baseUrl', async () => {
    let capturedUrl = '';

    globalThis.fetch = (async (input: string | URL | Request) => {
      capturedUrl = typeof input === 'string' ? input : (input as URL).toString();
      return new Response(JSON.stringify({
        data: { image_base64: ['dGVzdA=='] },
        base_resp: { status_code: 0 },
      }), { status: 200 });
    }) as typeof fetch;

    await generateMiniMaxImage(
      mockConfig({ baseUrl: 'https://api.minimaxi.com/anthropic/v1' }),
      { prompt: 'test' },
    );

    expect(capturedUrl).toBe('https://api.minimaxi.com/v1/image_generation');
  });

  it('passes width/height for image-01 when size is specified', async () => {
    let capturedBody: Record<string, unknown> = {};

    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string);
      return new Response(JSON.stringify({
        data: { image_base64: ['dGVzdA=='] },
        base_resp: { status_code: 0 },
      }), { status: 200 });
    }) as typeof fetch;

    await generateMiniMaxImage(
      mockConfig(),
      { prompt: 'test', model: 'image-01', size: '1024x768' },
    );

    expect(capturedBody.width).toBe(1024);
    expect(capturedBody.height).toBe(768);
  });

  it('does not pass width/height for image-01-live', async () => {
    let capturedBody: Record<string, unknown> = {};

    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string);
      return new Response(JSON.stringify({
        data: { image_base64: ['dGVzdA=='] },
        base_resp: { status_code: 0 },
      }), { status: 200 });
    }) as typeof fetch;

    await generateMiniMaxImage(
      mockConfig(),
      { prompt: 'test', model: 'image-01-live', size: '1024x768' },
    );

    expect(capturedBody.width).toBeUndefined();
    expect(capturedBody.height).toBeUndefined();
  });

  it('throws on API error status_code', async () => {
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({
        base_resp: { status_code: 1026, status_msg: 'sensitive content' },
      }), { status: 200 });
    }) as typeof fetch;

    await expect(
      generateMiniMaxImage(mockConfig(), { prompt: 'bad prompt' }),
    ).rejects.toThrow('error 1026: sensitive content');
  });

  it('throws on HTTP error', async () => {
    globalThis.fetch = (async () => {
      return new Response('Unauthorized', { status: 401 });
    }) as typeof fetch;

    await expect(
      generateMiniMaxImage(mockConfig(), { prompt: 'test' }),
    ).rejects.toThrow('failed (401)');
  });

  it('throws when response has no image data', async () => {
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({
        data: {},
        base_resp: { status_code: 0 },
      }), { status: 200 });
    }) as typeof fetch;

    await expect(
      generateMiniMaxImage(mockConfig(), { prompt: 'test' }),
    ).rejects.toThrow('returned no image data');
  });

  it('truncates prompt to 1500 chars', async () => {
    let capturedBody: Record<string, unknown> = {};

    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string);
      return new Response(JSON.stringify({
        data: { image_base64: ['dGVzdA=='] },
        base_resp: { status_code: 0 },
      }), { status: 200 });
    }) as typeof fetch;

    const longPrompt = 'x'.repeat(2000);
    await generateMiniMaxImage(mockConfig(), { prompt: longPrompt });

    expect((capturedBody.prompt as string).length).toBe(1500);
  });
});

describe('sdkSupportsImageGeneration includes minimax', () => {
  it('returns true for minimax', async () => {
    const { sdkSupportsImageGeneration } = await import('../../src/llm/sdk-registry.js');
    expect(sdkSupportsImageGeneration('minimax')).toBe(true);
  });
});
