import { afterEach, describe, expect, it } from 'vitest';
import { toMessageCreateOptions } from '../src/gateway.js';
import { formatOutboundBody } from '../src/protocol.js';
import { BLOCKED_MEDIA_URLS, fakeOutboundMediaNetwork, PNG, PUBLIC_MEDIA_URL } from '../../test-utils/outbound-media.js';

let network: ReturnType<typeof fakeOutboundMediaNetwork>;
afterEach(() => network?.restore());

describe('Discord attachment URL (#1250 第 46 批)', () => {
  it.each(BLOCKED_MEDIA_URLS)('does not let discord.js download a %s on this host and keeps the message', async (_label, url) => {
    network = fakeOutboundMediaNetwork();
    const options = await toMessageCreateOptions(formatOutboundBody([
      { type: 'text', data: { text: 'see' } },
      { type: 'image', data: { media: { kind: 'url', value: url }, name: 'a.png' } },
    ]), { fetchMedia: network.fetchMedia });
    expect(options.files ?? []).toEqual([]);
    expect(options.content).toContain('see');
    expect(options.content).toContain('未发送');
    network.expectNoPrivateConnection();
  });

  it('downloads a public HTTPS attachment through the pinned fetch and sends bytes, never the URL', async () => {
    network = fakeOutboundMediaNetwork();
    const options = await toMessageCreateOptions(formatOutboundBody([
      { type: 'image', data: { media: { kind: 'url', value: PUBLIC_MEDIA_URL }, name: 'a.png' } },
    ]), { fetchMedia: network.fetchMedia });
    const attachment = (options.files as Array<{ attachment: unknown; name?: string }>)[0]!;
    expect(Buffer.isBuffer(attachment.attachment) && (attachment.attachment as Buffer).equals(PNG)).toBe(true);
    expect(attachment.name).toBe('a.png');
    expect(network.connected).toEqual([{ host: 'cdn.example', address: '93.184.216.34' }]);
    network.expectNoPrivateConnection();
  });
});
