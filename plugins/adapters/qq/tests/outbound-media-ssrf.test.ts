import { afterEach, describe, expect, it } from 'vitest';
import { probeImageSize } from '../src/image-size.js';
import { BLOCKED_MEDIA_URLS, fakeOutboundMediaNetwork, PUBLIC_MEDIA_URL } from '../../test-utils/outbound-media.js';

let network: ReturnType<typeof fakeOutboundMediaNetwork>;
afterEach(() => network?.restore());

describe('QQ markdown image size probe (#1250 第 46 批)', () => {
  it.each(BLOCKED_MEDIA_URLS)('does not probe a %s on this host', async (_label, url) => {
    network = fakeOutboundMediaNetwork();
    await expect(probeImageSize(url, { fetchMedia: network.fetchMedia })).resolves.toBeUndefined();
    network.expectNoPrivateConnection();
  });

  it('probes a public HTTPS image through the pinned fetch', async () => {
    network = fakeOutboundMediaNetwork();
    await expect(probeImageSize(PUBLIC_MEDIA_URL, { fetchMedia: network.fetchMedia })).resolves.toEqual({ width: 1, height: 1 });
    expect(network.connected).toEqual([{ host: 'cdn.example', address: '93.184.216.34' }]);
    network.expectNoPrivateConnection();
  });
});
