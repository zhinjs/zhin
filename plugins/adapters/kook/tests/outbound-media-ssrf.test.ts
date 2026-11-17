import { Message } from 'kook-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendKookOutbound } from '../src/outbound.js';
import { RuntimeKookClient, type KookClientTransport } from '../src/ws.js';
import { BLOCKED_MEDIA_URLS, fakeOutboundMediaNetwork, PNG, PUBLIC_MEDIA_URL } from '../../test-utils/outbound-media.js';

const conversation = { endpoint: { id: 'bot', adapter: 'kook' }, kind: 'channel' as const, id: 'channel' };
let network: ReturnType<typeof fakeOutboundMediaNetwork>;
afterEach(() => network?.restore());

function setup() {
  network = fakeOutboundMediaNetwork();
  const sendChannelMsg = vi.fn(async () => ({ msg_id: 'real-id' }));
  const uploadMedia = vi.fn(async () => 'https://img.kookapp.cn/image.png');
  const client = { sendChannelMsg, sendPrivateMsg: vi.fn(), uploadMedia } as unknown as KookClientTransport;
  return { client, sendChannelMsg, uploadMedia };
}

async function cardModules(client: KookClientTransport, card: unknown) {
  const [content] = await Message.processMessage.call(client as never, card as never);
  return JSON.parse(content)[0].modules as unknown[];
}

describe('KOOK card image URL (#1250 第 46 批)', () => {
  it.each(BLOCKED_MEDIA_URLS)('does not download a %s on this host and still sends the card', async (_label, url) => {
    const { client, sendChannelMsg, uploadMedia } = setup();
    await expect(sendKookOutbound(client, { conversation, payload: [
      { type: 'text', data: { text: 'see' } },
      { type: 'image', data: { media: { kind: 'url', value: url } } },
    ] }, { fetchMedia: network.fetchMedia })).resolves.toBe('real-id');
    expect(uploadMedia).not.toHaveBeenCalled();
    const modules = await cardModules(client, sendChannelMsg.mock.calls[0]![1]);
    expect(JSON.stringify(modules)).toContain('see');
    expect(JSON.stringify(modules)).toContain('图片未发送');
    network.expectNoPrivateConnection();
  });

  it('downloads a public HTTPS image through the pinned fetch and re-uploads the bytes', async () => {
    const { client, uploadMedia } = setup();
    await sendKookOutbound(client, { conversation, payload: [{ type: 'image', data: { media: { kind: 'url', value: PUBLIC_MEDIA_URL } } }] }, { fetchMedia: network.fetchMedia });
    expect(uploadMedia).toHaveBeenCalledWith(PNG);
    expect(network.connected).toEqual([{ host: 'cdn.example', address: '93.184.216.34' }]);
    network.expectNoPrivateConnection();
  });

  it.each([
    ['metadata address', 'https://169.254.169.254/latest/meta-data/'],
    ['plain http', 'http://cdn.example/a.png'],
    ['loopback', 'https://127.0.0.1/a.png'],
  ])('RuntimeKookClient.uploadMedia refuses a %s source URL without downloading it', async (_label, url) => {
    network = fakeOutboundMediaNetwork();
    const client = new RuntimeKookClient({ token: 'fixture', mode: 'websocket' });
    try {
      await expect(client.uploadMedia(url)).rejects.toMatchObject({ code: 'outbound_media_url_blocked', disposition: 'not_sent' });
      network.expectNoPrivateConnection();
    } finally { await client.disconnect(); }
  });
});
