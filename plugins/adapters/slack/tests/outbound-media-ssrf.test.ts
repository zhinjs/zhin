import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendSlackContent, type SlackChatClient } from '../src/slack-outbound.js';
import { BLOCKED_MEDIA_URLS, fakeOutboundMediaNetwork, PNG, PUBLIC_MEDIA_URL } from '../../test-utils/outbound-media.js';

let network: ReturnType<typeof fakeOutboundMediaNetwork>;
afterEach(() => network?.restore());

function setup() {
  network = fakeOutboundMediaNetwork();
  const postMessage = vi.fn(async () => ({ ok: true, ts: '1.0' }));
  const filesUploadV2 = vi.fn(async () => ({ ok: true }));
  const client = { chat: { postMessage, update: vi.fn() }, filesUploadV2 } as unknown as SlackChatClient;
  const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } as never;
  return { client, postMessage, filesUploadV2, logger };
}

describe('Slack file URL (#1250 第 46 批)', () => {
  it.each(BLOCKED_MEDIA_URLS)('does not download a %s on this host and still posts the message', async (_label, url) => {
    const { client, postMessage, filesUploadV2, logger } = setup();
    await expect(sendSlackContent(client, { channel: 'C1', logger, fetchMedia: network.fetchMedia, content: [
      { type: 'text', data: { text: 'see' } },
      { type: 'file', data: { media: { kind: 'url', value: url }, name: 'report.pdf' } },
    ] })).resolves.toEqual({ ts: '1.0' });
    expect(filesUploadV2).not.toHaveBeenCalled();
    expect(JSON.stringify(postMessage.mock.calls[0]![0])).toContain('文件未发送');
    expect(JSON.stringify(postMessage.mock.calls[0]![0])).toContain('see');
    network.expectNoPrivateConnection();
  });

  it('downloads a public HTTPS file through the pinned fetch and uploads it', async () => {
    const { client, filesUploadV2, logger } = setup();
    await sendSlackContent(client, { channel: 'C1', logger, fetchMedia: network.fetchMedia, content: [
      { type: 'file', data: { media: { kind: 'url', value: PUBLIC_MEDIA_URL }, name: 'a.png' } },
    ] });
    expect(filesUploadV2).toHaveBeenCalledWith(expect.objectContaining({ file: PNG }));
    expect(network.connected).toEqual([{ host: 'cdn.example', address: '93.184.216.34' }]);
    network.expectNoPrivateConnection();
  });
});
