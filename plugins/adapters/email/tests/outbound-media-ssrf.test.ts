import { afterEach, describe, expect, it } from 'vitest';
import { formatOutboundMail, materializeRemoteMailAttachments } from '../src/protocol.js';
import { BLOCKED_MEDIA_URLS, fakeOutboundMediaNetwork, PNG, PUBLIC_MEDIA_URL } from '../../test-utils/outbound-media.js';

let network: ReturnType<typeof fakeOutboundMediaNetwork>;
afterEach(() => network?.restore());

const mail = (url: string) => formatOutboundMail([
  { type: 'text', data: { text: 'see' } },
  { type: 'image', data: { media: { kind: 'url', value: url }, alt: 'chart' } },
  { type: 'file', data: { media: { kind: 'url', value: url }, name: 'r.pdf' } },
], { from: 'bot@example.com', to: 'user@example.com' });

describe('e-mail attachment URL (#1250 第 46 批)', () => {
  it.each(BLOCKED_MEDIA_URLS)('does not let nodemailer download a %s on this host and still sends the mail', async (_label, url) => {
    network = fakeOutboundMediaNetwork();
    const out = await materializeRemoteMailAttachments(mail(url), { fetchMedia: network.fetchMedia });
    expect(out.attachments ?? []).toEqual([]);
    expect(out.text).toContain('see');
    expect(out.text).toContain('图片未发送');
    expect(out.text).toContain('文件未发送');
    expect(out.html).not.toContain('cid:');
    expect(out.html).toContain('图片未发送');
    expect(JSON.stringify(out)).not.toContain('"path"');
    network.expectNoPrivateConnection();
  });

  it('downloads a public HTTPS attachment through the pinned fetch and attaches its content', async () => {
    network = fakeOutboundMediaNetwork();
    const out = await materializeRemoteMailAttachments(mail(PUBLIC_MEDIA_URL), { fetchMedia: network.fetchMedia });
    expect(out.attachments).toHaveLength(2);
    for (const attachment of out.attachments!) {
      expect(attachment).not.toHaveProperty('path');
      expect(attachment).toMatchObject({ content: PNG.toString('base64'), encoding: 'base64' });
    }
    expect(out.html).toContain(`cid:${out.attachments![0]!.cid}`);
    network.expectNoPrivateConnection();
  });

  it('leaves local and inline attachments alone', async () => {
    network = fakeOutboundMediaNetwork();
    const input = formatOutboundMail([{ type: 'file', data: { media: { kind: 'base64', value: 'QUJD' }, name: 'a.txt' } }], { from: 'a@x', to: 'b@x' });
    expect(await materializeRemoteMailAttachments(input, { fetchMedia: network.fetchMedia })).toBe(input);
    expect(network.connected).toEqual([]);
  });
});
