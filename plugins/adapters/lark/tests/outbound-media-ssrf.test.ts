import { createEndpointHarness } from '../../test-utils/endpoint.js';
import { BLOCKED_MEDIA_URLS, fakeOutboundMediaNetwork, PUBLIC_MEDIA_URL } from '../../test-utils/outbound-media.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { createHttpHost } from '@zhin.js/host-http/node';
import { LarkEndpoint } from '../src/endpoint.js';
import { resolveLarkConfig } from '../src/protocol.js';
import { resolveMediaBinary } from '../src/media-upload.js';

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const close of cleanups.splice(0)) await close(); });

async function setup() {
  const network = fakeOutboundMediaNetwork();
  cleanups.push(() => network.restore());
  const calls: Array<{ url: string; body: unknown }> = [];
  const fetch = vi.fn(async (url: string, init?: { body?: unknown }) => {
    if (url.includes('/auth/')) return { ok: true, status: 200, text: async () => '', json: async () => ({ code: 0, tenant_access_token: 't', expire: 7200 }) };
    calls.push({ url, body: init?.body });
    if (url.includes('/im/v1/images')) return { ok: true, status: 200, text: async () => '', json: async () => ({ code: 0, data: { image_key: 'img_up' } }) };
    return { ok: true, status: 200, text: async () => '', json: async () => ({ code: 0, data: { message_id: 'om_1' } }) };
  });
  const endpoint = await createEndpointHarness(() => new LarkEndpoint({
    id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'lark'),
    http: createHttpHost({ host: '127.0.0.1', port: 0 }),
    config: resolveLarkConfig({ id: 'test', appId: 'app', appSecret: 'secret', apiBaseUrl: 'https://example.invalid' }),
    fetch,
    fetchMedia: network.fetchMedia,
  }), { capabilities: ['inbound', 'outbound'], operations: ['recall'] });
  cleanups.push(() => endpoint.stop());
  await endpoint.start(); endpoint.open();
  const conversation = { endpoint: { id: 'test', adapter: 'lark' }, kind: 'group' as const, id: 'oc_test' };
  return { endpoint, conversation, calls, network };
}

describe('lark outbound media URL (#1250 第 46 批)', () => {
  it.each(BLOCKED_MEDIA_URLS)('does not download a %s on this host and still sends the message', async (_label, url) => {
    const { endpoint, conversation, calls, network } = await setup();
    const id = await endpoint.send({ conversation, payload: [
      { type: 'text', data: { text: 'see' } },
      { type: 'image', data: { media: { kind: 'url', value: url } } },
    ] });
    expect(id).toBe('om_1');
    expect(calls.some(call => call.url.includes('/im/v1/images'))).toBe(false);
    const sent = calls.find(call => call.url.includes('/im/v1/messages'))!;
    expect(String(sent.body)).toContain('see');
    expect(String(sent.body)).toContain('图片未发送');
    network.expectNoPrivateConnection();
  });

  it('downloads a public HTTPS image through the pinned fetch and uploads it', async () => {
    const { endpoint, conversation, calls, network } = await setup();
    await expect(endpoint.send({ conversation, payload: [{ type: 'image', data: { media: { kind: 'url', value: PUBLIC_MEDIA_URL } } }] })).resolves.toBe('om_1');
    expect(network.connected).toEqual([{ host: 'cdn.example', address: '93.184.216.34' }]);
    expect(calls.some(call => call.url.includes('/im/v1/images'))).toBe(true);
    expect(String(calls.find(call => call.url.includes('/im/v1/messages'))!.body)).toContain('img_up');
    network.expectNoPrivateConnection();
  });

  it('resolveMediaBinary refuses a private URL with a refusal the caller can turn into a notice', async () => {
    const network = fakeOutboundMediaNetwork();
    cleanups.push(() => network.restore());
    await expect(resolveMediaBinary({ kind: 'url', value: 'https://169.254.169.254/x' }, { fetchMedia: network.fetchMedia }))
      .rejects.toMatchObject({ code: 'outbound_media_url_blocked', refused: true });
    expect(network.connected).toEqual([]);
  });
});

describe('MediaResolveOptions.download (deprecated, #1250 第 46 批)', () => {
  it('is ignored: a caller-supplied downloader cannot bypass the SSRF-checked fetch', async () => {
    const network = fakeOutboundMediaNetwork();
    cleanups.push(() => network.restore());
    const download = vi.fn(async () => Buffer.from('internal secret'));
    await expect(resolveMediaBinary(
      { kind: 'url', value: 'https://169.254.169.254/latest/meta-data/' },
      { download, fetchMedia: network.fetchMedia },
    )).rejects.toMatchObject({ code: 'outbound_media_url_blocked', refused: true });
    await expect(resolveMediaBinary({ kind: 'url', value: PUBLIC_MEDIA_URL }, { download, fetchMedia: network.fetchMedia }))
      .resolves.toMatchObject({ data: expect.any(Buffer) });
    expect(download).not.toHaveBeenCalled();
    network.expectNoPrivateConnection();
  });
});
