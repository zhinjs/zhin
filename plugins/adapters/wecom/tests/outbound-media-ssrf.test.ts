import { createEndpointHarness } from '../../test-utils/endpoint.js';
import { BLOCKED_MEDIA_URLS, fakeOutboundMediaNetwork, PUBLIC_MEDIA_URL } from '../../test-utils/outbound-media.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { createHttpHost } from '@zhin.js/host-http/node';
import { WecomEndpoint } from '../src/endpoint.js';
import { resolveWecomConfig } from '../src/protocol.js';

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const close of cleanups.splice(0)) await close(); });

const config = resolveWecomConfig({
  id: 'test-wecom-bot', corpId: 'wwtestcorpid', agentId: '100001', agentSecret: 'secret', token: 'token',
  encodingAESKey: Buffer.alloc(32, 7).toString('base64').replace(/=+$/, ''), webhookPath: '/wecom/callback',
  apiBaseUrl: 'https://qyapi.weixin.qq.com',
});

async function setup() {
  const network = fakeOutboundMediaNetwork();
  cleanups.push(() => network.restore());
  const calls: Array<{ url: string; body: unknown }> = [];
  const fetch = vi.fn(async (url: string, init?: { body?: unknown }) => {
    if (url.includes('/gettoken')) return { ok: true, status: 200, text: async () => '', json: async () => ({ errcode: 0, access_token: 'tok', expires_in: 7200 }) };
    calls.push({ url, body: init?.body });
    if (url.includes('/media/upload')) return { ok: true, status: 200, text: async () => '', json: async () => ({ errcode: 0, type: 'image', media_id: 'MID_9' }) };
    return { ok: true, status: 200, text: async () => '', json: async () => ({ errcode: 0, msgid: 'out-9' }) };
  });
  const http = createHttpHost({ host: '127.0.0.1', port: 0 });
  const gateway = { receive: vi.fn(async () => Object.freeze({ matched: false })), send: vi.fn(async () => 'sent') };
  const endpoint = await createEndpointHarness(() => new WecomEndpoint({
    id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'wecom'), gateway, http, config, fetch, fetchMedia: network.fetchMedia,
  } as ConstructorParameters<typeof WecomEndpoint>[0]), { capabilities: ['inbound', 'outbound'], operations: ['recall'] });
  cleanups.push(() => endpoint.stop());
  await endpoint.start();
  const conversation = { endpoint: { id: 'wecom-endpoint', adapter: 'wecom' }, kind: 'private' as const, id: 'user001' };
  return { endpoint, conversation, calls, network };
}

describe('wecom outbound media URL (#1250 第 46 批)', () => {
  it.each(BLOCKED_MEDIA_URLS)('does not download a %s on this host and still sends the message', async (_label, url) => {
    const { endpoint, conversation, calls, network } = await setup();
    await expect(endpoint.send({ conversation, payload: [{ type: 'image', data: { media: { kind: 'url', value: url } } }] })).resolves.toBeTruthy();
    expect(calls.some(call => call.url.includes('/media/upload'))).toBe(false);
    const sent = calls.filter(call => call.url.includes('/message/send')).map(call => String(call.body)).join('\n');
    expect(sent).toContain('图片未发送');
    network.expectNoPrivateConnection();
  });

  it('downloads a public HTTPS image through the pinned fetch and uploads it', async () => {
    const { endpoint, conversation, calls, network } = await setup();
    await expect(endpoint.send({ conversation, payload: [{ type: 'image', data: { media: { kind: 'url', value: PUBLIC_MEDIA_URL } } }] })).resolves.toBe('out-9');
    expect(network.connected).toEqual([{ host: 'cdn.example', address: '93.184.216.34' }]);
    expect(calls.some(call => call.url.includes('/media/upload'))).toBe(true);
    expect(String(calls.find(call => call.url.includes('/message/send'))!.body)).toContain('MID_9');
    network.expectNoPrivateConnection();
  });
});
