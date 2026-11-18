import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLogger } from '@zhin.js/logger';
import { createOutboundMediaFetcher } from '../../../../packages/im/core/src/built/outbound-media-fetch.js';
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

  it('a server that ignores Range and sends the whole image is a failed probe, not a refusal, and not a warning (L7)', async () => {
    const warn = vi.spyOn(getLogger('im.outbound'), 'warn').mockImplementation(() => undefined);
    const debug = vi.spyOn(getLogger('im.outbound'), 'debug').mockImplementation(() => undefined);
    const sent: Array<Readonly<Record<string, string>>> = [];
    const fetchMedia = createOutboundMediaFetcher({
      lookup: async () => [{ address: '93.184.216.34', family: 4 }],
      connect: async (_url, _address, headers) => {
        sent.push(headers);
        return { status: 200, statusText: 'OK', headers: { 'content-type': 'image/png' }, body: new Uint8Array(200_000) };
      },
    });
    const errors: unknown[] = [];
    const recording: typeof fetchMedia = (url, options) => fetchMedia(url, options).catch((error: unknown) => { errors.push(error); throw error; });
    await expect(probeImageSize(PUBLIC_MEDIA_URL, { fetchMedia: recording })).resolves.toBeUndefined();
    expect(sent[0]).toEqual({ Range: 'bytes=0-65535' });
    expect(errors).toEqual([expect.objectContaining({ code: 'outbound_media_too_large', refused: false })]);
    expect(warn).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledTimes(1);
    warn.mockRestore();
    debug.mockRestore();
  });
});
