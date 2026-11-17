import { afterEach, describe, expect, it } from 'vitest';
import { fetchIcqqRemoteMedia } from '../src/outbound-media.js';
import { formatOutboundBody } from '../src/protocol.js';
import { BLOCKED_MEDIA_URLS, fakeOutboundMediaNetwork, PNG, PUBLIC_MEDIA_URL } from '../../test-utils/outbound-media.js';

let network: ReturnType<typeof fakeOutboundMediaNetwork>;
afterEach(() => network?.restore());

describe('ICQQ outbound media URL (#1250 第 46 批)', () => {
  it.each(BLOCKED_MEDIA_URLS)('never hands a %s to the SDK (which would download it here) and keeps the message', async (_label, url) => {
    network = fakeOutboundMediaNetwork();
    const content = await fetchIcqqRemoteMedia([
      { type: 'text', data: { text: 'see' } },
      { type: 'image', data: { media: { kind: 'url', value: url } } },
      { type: 'video', data: { media: { kind: 'url', value: url } } },
    ] as never, { fetchMedia: network.fetchMedia });
    expect(content).toEqual([
      { type: 'text', data: { text: 'see' } },
      { type: 'text', data: { text: '[图片未发送：媒体地址不被允许]' } },
      { type: 'text', data: { text: '[视频未发送：媒体地址不被允许]' } },
    ]);
    expect(JSON.stringify(formatOutboundBody(content))).not.toContain(new URL(url).hostname);
    network.expectNoPrivateConnection();
  });

  it('downloads a public HTTPS image through the pinned fetch and hands the SDK base64', async () => {
    network = fakeOutboundMediaNetwork();
    const content = await fetchIcqqRemoteMedia([{ type: 'image', data: { media: { kind: 'url', value: PUBLIC_MEDIA_URL } } }] as never, { fetchMedia: network.fetchMedia });
    expect(content).toEqual([{ type: 'image', data: { media: { kind: 'base64', value: PNG.toString('base64'), mime_type: 'image/png' } } }]);
    expect(JSON.stringify(formatOutboundBody(content))).toContain(`base64://${PNG.toString('base64')}`);
    expect(network.connected).toEqual([{ host: 'cdn.example', address: '93.184.216.34' }]);
    network.expectNoPrivateConnection();
  });
});
