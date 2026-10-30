import { createRequire } from 'node:module';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { createLarkSdkHttpInstance } from '../src/sdk-http.js';
import type { LarkFetch } from '../src/client.js';

const require = createRequire(import.meta.url), sdkRequire = createRequire(require.resolve('@larksuiteoapi/node-sdk'));
describe('actual SDK HttpInstance transport contract', () => {
  it('preserves real SDK Node FormData boundary and bytes without serializing its stream', async () => {
    const FormData = sdkRequire('form-data');
    const form = new FormData(); form.append('image_type', 'message'); form.append('image', Readable.from([Buffer.from([0, 1, 255])]), { filename: 'native.bin' });
    let observed: Buffer | undefined;
    const fetch: LarkFetch = vi.fn(async (_url, init) => {
      expect(init?.headers?.['content-type']).toMatch(/^multipart\/form-data; boundary=/);
      expect(init?.duplex).toBe('half');
      const chunks: Buffer[] = []; for await (const chunk of init?.body as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk)); observed = Buffer.concat(chunks);
      return { ok: true, status: 200, json: async () => ({ code: 0 }), text: async () => '' };
    });
    expect(await createLarkSdkHttpInstance(fetch).post('https://fake.invalid/upload', form)).toEqual({ code: 0 });
    expect(observed?.includes(Buffer.from([0, 1, 255]))).toBe(true); expect(observed?.toString()).toContain('filename="native.bin"');
  });
  it('preserves SDK binary/stream readers and return_headers shape on the native response', async () => {
    const sdk = createLarkSdkHttpInstance(async () => new Response(Buffer.from([0, 1, 255]), { headers: { 'x-native': 'present' } }));
    const binary = await sdk.get('https://fake.invalid/file', { responseType: 'arraybuffer', $return_headers: true });
    expect(binary).toEqual({ data: Buffer.from([0, 1, 255]), headers: { 'x-native': 'present' } });
    const stream = await sdk.get('https://fake.invalid/file', { responseType: 'stream' }); const chunks = []; for await (const part of stream) chunks.push(part);
    expect(Buffer.concat(chunks)).toEqual(Buffer.from([0, 1, 255]));
  });
});

it('isolates actual SDK token caches for old and candidate credentials of the same app', async () => {
  const { LarkClient } = await import('../src/client.js');
  const { resolveLarkConfig } = await import('../src/protocol.js');
  const requests: string[] = [];
  const fetch: LarkFetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)); requests.push(body.app_secret);
    return { ok: true, status: 200, json: async () => ({ code: 0, tenant_access_token: `synthetic-${body.app_secret}`, expire: 7200 }), text: async () => '' };
  };
  const previous = new LarkClient({ id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'old'), config: resolveLarkConfig({ id: 'old', appId: 'same-app', appSecret: 'old' }), fetch });
  const candidate = new LarkClient({ id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'new'), config: resolveLarkConfig({ id: 'new', appId: 'same-app', appSecret: 'new' }), fetch });
  try {
    expect(requests).toEqual([]);
    expect(await previous.tokenManager.getTenantAccessToken()).toBe('synthetic-old');
    expect(await candidate.tokenManager.getTenantAccessToken()).toBe('synthetic-new');
    expect(await previous.tokenManager.getTenantAccessToken()).toBe('synthetic-old');
    expect(requests).toEqual(['old', 'new']);
  } finally { await previous[Symbol.asyncDispose](); await candidate[Symbol.asyncDispose](); }
});
