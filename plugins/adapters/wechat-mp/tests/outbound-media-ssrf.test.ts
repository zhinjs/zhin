import { createEndpointHarness } from '../../test-utils/endpoint.js';
import { BLOCKED_MEDIA_URLS, fakeOutboundMediaNetwork, PUBLIC_MEDIA_URL } from '../../test-utils/outbound-media.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { createHttpHost } from '@zhin.js/host-http/node';
import { WeChatMpEndpoint } from '../src/endpoint.js';
import { resolveMediaBinary } from '../src/media-upload.js';
import { resolveWeChatMpConfig } from '../src/protocol.js';

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const close of cleanups.splice(0)) await close(); });

async function setup() {
  const network = fakeOutboundMediaNetwork();
  cleanups.push(() => network.restore());
  const calls: Array<{ url: string; body: unknown }> = [];
  const fetch = vi.fn(async (url: string, init?: { body?: unknown }) => {
    if (url.includes('/token')) return { data: { access_token: 'tok', expires_in: 7200 } };
    calls.push({ url, body: init?.body });
    if (url.includes('/media/upload')) return { data: { media_id: 'MID_7' } };
    return { data: { errcode: 0, msgid: 42 } };
  });
  const http = createHttpHost({ host: '127.0.0.1', port: 0 });
  const gateway = { receive: vi.fn(async () => Object.freeze({ matched: false })), send: vi.fn(async () => 'sent') };
  const endpoint = await createEndpointHarness(() => new WeChatMpEndpoint({
    id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'wechat-mp'), gateway, http,
    config: resolveWeChatMpConfig({ id: 'bot', appId: 'wx', appSecret: 'sec', token: 'tok', encrypt: false, replyMode: 'customer_service' }),
    fetch, fetchMedia: network.fetchMedia,
  } as ConstructorParameters<typeof WeChatMpEndpoint>[0]), { capabilities: ['inbound', 'outbound'] });
  cleanups.push(() => endpoint.stop());
  await endpoint.start();
  const conversation = { endpoint: { id: 'wechat-mp', adapter: 'wechat-mp' }, kind: 'private' as const, id: 'oUser' };
  return { endpoint, conversation, calls, network };
}

const sentBodies = (calls: Array<{ url: string; body: unknown }>) =>
  calls.filter(call => !call.url.includes('/media/upload')).map(call => JSON.stringify(call.body)).join('\n');

describe('wechat-mp outbound media URL (#1250 第 46 批)', () => {
  it.each(BLOCKED_MEDIA_URLS)('does not download a %s on this host and still sends the message', async (_label, url) => {
    const { endpoint, conversation, calls, network } = await setup();
    await expect(endpoint.send({ conversation, payload: [{ type: 'image', data: { media: { kind: 'url', value: url } } }] })).resolves.toBeTruthy();
    expect(calls.some(call => call.url.includes('/media/upload'))).toBe(false);
    expect(sentBodies(calls)).toContain('图片未发送');
    network.expectNoPrivateConnection();
  });

  it('downloads a public HTTPS image through the pinned fetch and uploads it', async () => {
    const { endpoint, conversation, calls, network } = await setup();
    await expect(endpoint.send({ conversation, payload: [{ type: 'image', data: { media: { kind: 'url', value: PUBLIC_MEDIA_URL } } }] })).resolves.toBeTruthy();
    expect(network.connected).toEqual([{ host: 'cdn.example', address: '93.184.216.34' }]);
    expect(calls.some(call => call.url.includes('/media/upload'))).toBe(true);
    expect(sentBodies(calls)).toContain('MID_7');
    network.expectNoPrivateConnection();
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
