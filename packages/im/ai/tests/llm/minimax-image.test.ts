/** Native MiniMax image protocol through the formal Profile and actual product Driver. */
import { miniMaxProvider } from '../../src/providers/api-key.js';
import { driverFixture, callContext } from '../providers/fixtures.js';
import type { JsonObject, GenerateImageInput } from '../../src/provider/types.js';

function fixture(input: { model?: string; parameters?: JsonObject; response?: () => Response; token?: string } = {}) {
  const requests: Request[] = [];
  const value = driverFixture({ definition: miniMaxProvider,
    model: { id: input.model ?? 'image-01', kinds: ['image'], protocol: 'minimax-images' }, parameters: input.parameters,
    grant: { token: input.token ?? 'test-key-123', headers: {}, revision: '1' },
    fetch: async (url, init) => { requests.push(new Request(url, init)); return input.response?.() ?? Response.json({ data: { image_base64: ['aW1hZ2VkYXRh'] }, base_resp: { status_code: 0 } }); } });
  async function generate(request: GenerateImageInput['request']) {
    const client = await value.runtime.openOperation({ context: callContext });
    try { return await client.generateImage({ request }); } finally { await client.close(); }
  }
  return { ...value, requests, generate };
}

it('rejects a missing real key before HTTP', async () => {
  const f = fixture({ token: '' }); await expect(f.generate({ prompt: 'a cat' })).rejects.toMatchObject({ code: 'invalid-credential' }); expect(f.requests).toHaveLength(0);
});
it('rejects an empty prompt before authorization or HTTP', async () => {
  const f = fixture(); await expect(f.generate({ prompt: '' })).rejects.toThrow('requires prompt'); expect(f.authorize).not.toHaveBeenCalled(); expect(f.requests).toHaveLength(0);
});
it('sends the explicit fixed model, prompt, ratio and current key to the native MiniMax image target', async () => {
  const f = fixture(); const result = await f.generate({ prompt: 'a cute cat', aspectRatio: '16:9' });
  expect(f.requests[0].url).toBe('https://api.minimaxi.com/v1/image_generation');
  expect(await f.requests[0].json()).toMatchObject({ model: 'image-01', prompt: 'a cute cat', response_format: 'base64', aspect_ratio: '16:9' });
  expect(f.requests[0].headers.get('authorization')).toBe('Bearer test-key-123');
  expect(result).toEqual({ base64: 'aW1hZ2VkYXRh', mimeType: 'image/png', model: 'image-01' });
  expect(f.bindRequest).toHaveBeenCalledOnce();
});
it('uses width/height only on the model whose explicit protocol supports them', async () => {
  const f = fixture(); await f.generate({ prompt: 'test', size: '1024x768' }); expect(await f.requests[0].json()).toMatchObject({ width: 1024, height: 768 });
  const live = fixture({ model: 'image-01-live' }); await expect(live.generate({ prompt: 'test', size: '1024x768' })).rejects.toMatchObject({ code: 'unsupported-parameter' });
  expect(live.requests).toHaveLength(0); expect(live.authorize).not.toHaveBeenCalled();
});
it('retains a default ratio and appends an explicit Profile style suffix', async () => {
  const f = fixture({ parameters: { imageGeneration: { aspectRatio: '1:1', promptSuffix: 'watercolor' } } });
  await f.generate({ prompt: 'test' }); expect(await f.requests[0].json()).toMatchObject({ aspect_ratio: '1:1', prompt: 'test\nwatercolor' });
});
it('reports native API failure without copying remote diagnostics', async () => {
  const f = fixture({ response: () => Response.json({ base_resp: { status_code: 1026, status_msg: 'synthetic-private-rejection' } }) });
  const error = await f.generate({ prompt: 'bad prompt' }).catch(error => error);
  expect(error).toMatchObject({ code: 'invalid-response' }); expect(String(error)).not.toContain('synthetic-private');
});
it('preserves HTTP rejection status without copying response contents or replaying a paid request', async () => {
  const f = fixture({ response: () => new Response('synthetic-private-error', { status: 401 }) });
  const error = await f.generate({ prompt: 'test' }).catch(error => error);
  expect(error).toMatchObject({ statusCode: 401 }); expect(String(error)).not.toContain('synthetic-private'); expect(f.requests).toHaveLength(1);
});
it('rejects success without base64 image data rather than claiming a generated image', async () => {
  const f = fixture({ response: () => Response.json({ data: {}, base_resp: { status_code: 0 } }) });
  await expect(f.generate({ prompt: 'test' })).rejects.toMatchObject({ code: 'invalid-response' }); expect(f.requests).toHaveLength(1);
});
it('keeps the existing native prompt limit of 1500 characters', async () => {
  const f = fixture(); await f.generate({ prompt: 'x'.repeat(2000) }); expect((await f.requests[0].json()).prompt).toHaveLength(1500);
});
it('does not send a custom gateway key or prompt to the default image domain', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  const f = driverFixture({ definition: miniMaxProvider, options: { baseUrl: 'https://gateway.example/v1' }, model: { id: 'image-01', kinds: ['image'], protocol: 'minimax-images' }, fetch });
  const client = await f.runtime.openOperation({ context: callContext });
  try { await expect(client.generateImage({ request: { prompt: 'private prompt' } })).rejects.toMatchObject({ code: 'unsupported-capability' }); expect(fetch).not.toHaveBeenCalled(); expect(f.authorize).not.toHaveBeenCalled(); }
  finally { await client.close(); }
});


it('does not expose malformed native success content as JSON parser diagnostics', async () => {
  const f = fixture({ response: () => new Response('PRIVATE') });
  const error = await f.generate({ prompt: 'test' }).catch(error => error);
  expect(error).toBeInstanceOf(Error); expect(String(error)).not.toContain('PRIVATE');
});
