import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { IpadWechatEndpoint, mediaSource, resolveIpadWechatConfig } from '../src/index.js';
import { createEndpointHarness, createTestEventGateway } from '../../test-utils/endpoint.js';
import { BLOCKED_MEDIA_URLS, fakeOutboundMediaNetwork, PNG, PUBLIC_MEDIA_URL } from '../../test-utils/outbound-media.js';
import { FakeIpadClient, fakeSdk } from './fake-sdk.js';

let directory: string;
let network: ReturnType<typeof fakeOutboundMediaNetwork>;
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'ipad-wechat-ssrf-')); network = fakeOutboundMediaNetwork(); });
afterEach(() => { network.restore(); rmSync(directory, { recursive: true, force: true }); });

async function setup() {
  const client = new FakeIpadClient();
  const h = await createEndpointHarness(() => new IpadWechatEndpoint({
    id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'bot'),
    config: resolveIpadWechatConfig({ id: 'bot', dataDir: directory }),
    sdk: fakeSdk(client),
    fetchMedia: network.fetchMedia,
  }), { capabilities: ['inbound', 'outbound'], gateway: createTestEventGateway({ receive: vi.fn(async () => undefined) }) });
  return { h, client };
}
const conversation = { endpoint: { adapter: 'test-endpoint', id: 'bot' }, kind: 'private', id: 'wxid_alice' } as never;

describe('ipad-wechat outbound media URL (#1250 第 46 批)', () => {
  it.each(BLOCKED_MEDIA_URLS)('does not download a %s or hand it to the SDK, and still sends the message', async (_label, url) => {
    const { h, client } = await setup();
    try {
      await h.start(); h.open();
      await h.send({ conversation, payload: ['look', { type: 'image', data: { media: { kind: 'url', value: url } } }] });
      expect(client.sent.map(item => item.kind)).toEqual(['text', 'text']);
      expect(client.sent[1]!.content).toContain('图片未发送');
      expect(client.sent.some(item => typeof item.content === 'string' && item.content.includes(new URL(url).hostname))).toBe(false);
      network.expectNoPrivateConnection();
    } finally { await h.stop(); }
  });

  it('downloads a public HTTPS image through the pinned fetch and gives the SDK bytes, never the URL', async () => {
    const { h, client } = await setup();
    try {
      await h.start(); h.open();
      await h.send({ conversation, payload: [{ type: 'image', data: { media: { kind: 'url', value: PUBLIC_MEDIA_URL } } }] });
      expect(client.sent).toHaveLength(1);
      expect(client.sent[0]!.kind).toBe('image');
      expect(Buffer.from(client.sent[0]!.content as Uint8Array).equals(PNG)).toBe(true);
      expect(network.connected).toEqual([{ host: 'cdn.example', address: '93.184.216.34' }]);
      network.expectNoPrivateConnection();
    } finally { await h.stop(); }
  });

  it('mediaSource refuses a private URL with a refusal', async () => {
    await expect(mediaSource({ kind: 'url', value: 'https://10.0.0.1/a.png' }, undefined, network.fetchMedia))
      .rejects.toMatchObject({ code: 'outbound_media_url_blocked', refused: true });
    expect(network.connected).toEqual([]);
  });
});
