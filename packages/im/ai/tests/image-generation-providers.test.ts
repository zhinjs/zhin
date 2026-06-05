import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAIProvider, ZhipuProvider } from '../src/providers/openai.js';
import { CloudflareProvider } from '../src/providers/cloudflare.js';
import { GoogleProvider } from '../src/providers/google.js';
import { hasGenerateImage } from '../src/image-generation.js';

describe('image generation providers', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('hasGenerateImage detects ZhipuProvider', () => {
    const p = new ZhipuProvider({ apiKey: 'k' });
    expect(hasGenerateImage(p)).toBe(true);
  });

  it('ZhipuProvider.generateImage 支持 watermark_enabled 配置', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ b64_json: 'x' }] }), { status: 200 }),
    );
    const p = new ZhipuProvider({
      apiKey: 'k',
      imageGeneration: { watermarkEnabled: false, defaultModel: 'cogview-4' },
    });
    await p.generateImage({ prompt: 'cat' });
    const body = JSON.parse(String(fetchSpy.mock.calls[0]![1]?.body));
    expect(body).toMatchObject({
      watermark_enabled: false,
      model: 'cogview-4',
    });
  });

  it('ZhipuProvider.generateImage uses b64_json', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ b64_json: 'abc123' }] }), { status: 200 }),
    );
    const p = new ZhipuProvider({ apiKey: 'k' });
    const result = await p.generateImage({ prompt: 'a cat' });
    expect(result.base64).toBe('abc123');
    expect(result.model).toBe('cogview-3-flash');
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toContain('/images/generations');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: 'cogview-3-flash',
      prompt: 'a cat',
      watermark_enabled: true,
    });
  });

  it('ZhipuProvider.generateImage fetches url when no b64_json', async () => {
    fetchSpy
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ url: 'https://cdn.example/a.png' }] }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(Buffer.from('png-bytes'), {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        }),
      );
    const p = new ZhipuProvider({ apiKey: 'k' });
    const result = await p.generateImage({ prompt: 'dog', model: 'cogview-4' });
    expect(result.base64).toBe(Buffer.from('png-bytes').toString('base64'));
    expect(result.model).toBe('cogview-4');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('hasGenerateImage detects OpenAIProvider', () => {
    const p = new OpenAIProvider({ apiKey: 'k' });
    expect(hasGenerateImage(p)).toBe(true);
  });

  it('OpenAIProvider.generateImage uses gpt-image-2 by default', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ b64_json: 'oaiB64' }] }), { status: 200 }),
    );
    const p = new OpenAIProvider({ apiKey: 'k' });
    const result = await p.generateImage({ prompt: 'otter' });
    expect(result.base64).toBe('oaiB64');
    expect(result.model).toBe('gpt-image-2');
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toContain('/images/generations');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: 'gpt-image-2',
      prompt: 'otter',
    });
  });

  it('OpenAIProvider.generateImage passes quality from config', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ b64_json: 'x' }] }), { status: 200 }),
    );
    const p = new OpenAIProvider({
      apiKey: 'k',
      imageGeneration: { defaultModel: 'gpt-image-1', quality: 'high' },
    });
    await p.generateImage({ prompt: 'cat' });
    expect(JSON.parse(String(fetchSpy.mock.calls[0]![1]?.body))).toMatchObject({
      model: 'gpt-image-1',
      quality: 'high',
    });
  });

  it('hasGenerateImage detects GoogleProvider', () => {
    const p = new GoogleProvider({ apiKey: 'g' });
    expect(hasGenerateImage(p)).toBe(true);
  });

  it('GoogleProvider.generateImage calls generateContent with IMAGE modality', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          candidates: [{
            content: {
              parts: [{ inlineData: { mimeType: 'image/png', data: 'gemB64==' } }],
            },
          }],
        }),
        { status: 200 },
      ),
    );
    const p = new GoogleProvider({
      apiKey: 'g',
      imageGeneration: { defaultModel: 'gemini-3.1-flash-image-preview', aspectRatio: '16:9', imageSize: '2K' },
    });
    const result = await p.generateImage({ prompt: 'banana dish' });
    expect(result.base64).toBe('gemB64==');
    expect(result.model).toBe('gemini-3.1-flash-image-preview');
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toContain('gemini-3.1-flash-image-preview:generateContent');
    const headers = init?.headers as Record<string, string> | Headers | undefined;
    const apiKeyHeader = headers instanceof Headers
      ? headers.get('x-goog-api-key')
      : (headers as Record<string, string> | undefined)?.['x-goog-api-key'];
    expect(apiKeyHeader).toBe('g');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      contents: [{ parts: [{ text: 'banana dish' }] }],
      generationConfig: {
        responseModalities: ['IMAGE'],
        imageConfig: { aspectRatio: '16:9', imageSize: '2K' },
      },
    });
  });

  it('GoogleProvider.generateImage parses inline_data snake_case', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          candidates: [{
            content: {
              parts: [{ inline_data: { mime_type: 'image/jpeg', data: 'snakeB64' } }],
            },
          }],
        }),
        { status: 200 },
      ),
    );
    const p = new GoogleProvider({ apiKey: 'g' });
    const result = await p.generateImage({ prompt: 'x' });
    expect(result.base64).toBe('snakeB64');
    expect(result.mimeType).toBe('image/jpeg');
  });

  it('CloudflareProvider.generateImage parses result.image', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, result: { image: 'cfB64==' } }), { status: 200 }),
    );
    const p = new CloudflareProvider({ apiKey: 'k', accountId: 'acc1' });
    const result = await p.generateImage({ prompt: 'sunset' });
    expect(result.base64).toBe('cfB64==');
    expect(result.model).toBe('@cf/black-forest-labs/flux-1-schnell');
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe(
      'https://api.cloudflare.com/client/v4/accounts/acc1/ai/run/@cf/black-forest-labs/flux-1-schnell',
    );
    expect(JSON.parse(String(init?.body))).toMatchObject({
      prompt: 'sunset',
      num_steps: 4,
    });
  });
});
