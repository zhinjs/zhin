import { Message } from 'kook-client';
import { sendKookOutbound } from '../src/outbound.js';
import { RuntimeKookClient, type KookClientTransport } from '../src/ws.js';

const conversation = { endpoint: { id: 'bot', adapter: 'kook' }, kind: 'channel' as const, id: 'channel' };
function setup() {
  const sendChannelMsg = vi.fn(async () => ({ msg_id: 'real-id' }));
  const sendPrivateMsg = vi.fn(async () => ({ msg_id: 'private-id' }));
  const uploadMedia = vi.fn(async () => 'https://img.kookapp.cn/image.png');
  const client = { sendChannelMsg, sendPrivateMsg, uploadMedia } as unknown as KookClientTransport;
  return { client, sendChannelMsg, sendPrivateMsg, uploadMedia };
}
describe('KOOK native quote and mixed media', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('routes quote as the real SDK third argument', async () => {
    const { client, sendChannelMsg } = setup();
    await sendKookOutbound(client, { conversation, payload: [{ type: 'reply', data: { message_id: 'original' } }, { type: 'text', data: { text: 'answer' } }] });
    expect(sendChannelMsg).toHaveBeenCalledWith('channel', 'answer', { message_id: 'original' });
  });
  it('uploads canonical base64 bytes and preserves text plus image through real SDK card serialization', async () => {
    const { client, sendChannelMsg, uploadMedia } = setup();
    await sendKookOutbound(client, { conversation, payload: [{ type: 'text', data: { text: 'acceptance:image' } }, { type: 'image', data: { media: { kind: 'base64', value: 'QUJD', mime_type: 'image/png' } } }] });
    expect(uploadMedia).toHaveBeenCalledWith(Buffer.from('ABC'));
    const card = sendChannelMsg.mock.calls[0]![1];
    const [content, , type] = await Message.processMessage.call(client as never, card as never);
    expect(type).toBe(10);
    expect(JSON.parse(content)).toEqual([expect.objectContaining({ modules: [
      { type: 'section', mode: 'left', text: { type: 'kmarkdown', content: 'acceptance:image' } },
      { type: 'container', elements: [{ type: 'image', src: 'https://img.kookapp.cn/image.png', alt: 'image' }] },
    ] })]);
  });
  it('keeps private native quotes and rejects unsupported binary media', async () => {
    const { client, sendPrivateMsg, sendChannelMsg } = setup();
    await sendKookOutbound(client, { conversation: { ...conversation, kind: 'private' }, payload: [{ type: 'reply', data: { message_id: 'private-parent' } }, { type: 'text', data: { text: 'answer' } }] });
    expect(sendPrivateMsg).toHaveBeenCalledWith('channel', 'answer', { message_id: 'private-parent' });
    await expect(sendKookOutbound(client, { conversation, payload: [{ type: 'file', data: { media: { kind: 'base64', value: 'QUJD' } } }] })).rejects.toMatchObject({ disposition: 'rejected' });
    expect(sendChannelMsg).not.toHaveBeenCalled();
  });
  it('does not send a text substitute when upload fails', async () => {
    const { client, uploadMedia, sendChannelMsg } = setup();
    uploadMedia.mockRejectedValue(new Error('request "/v3/asset/create" error with code(403): private raw details'));
    const result = sendKookOutbound(client, { conversation, payload: [{ type: 'image', data: { media: { kind: 'base64', value: 'QUJD' } } }] });
    await expect(result).rejects.toMatchObject({ disposition: 'rejected', message: 'KOOK request rejected (code=403)' });
    expect(sendChannelMsg).not.toHaveBeenCalled();
  });
  it('never fabricates a receipt and keeps network uncertainty', async () => {
    const { client, sendChannelMsg } = setup();
    sendChannelMsg.mockResolvedValue({ msg_id: '' });
    await expect(sendKookOutbound(client, { conversation, payload: 'hello' })).rejects.toMatchObject({ disposition: 'unknown' });
    sendChannelMsg.mockRejectedValue(new Error('socket reset'));
    await expect(sendKookOutbound(client, { conversation, payload: 'hello' })).rejects.toMatchObject({ disposition: 'unknown' });
  });
  it('uses native binary FormData for the actual runtime SDK upload', async () => {
    const fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ code: 0, data: { url: 'https://img.kookapp.cn/upload.png' } }) }));
    vi.stubGlobal('fetch', fetch);
    const client = new RuntimeKookClient({ token: 'fixture', mode: 'websocket' });
    await expect(client.uploadMedia(Buffer.from('ABC'))).resolves.toContain('/upload.png');
    const file = fetch.mock.calls[0]![1].body.get('file') as File;
    expect(Buffer.from(await file.arrayBuffer())).toEqual(Buffer.from('ABC'));
    await client.uploadMedia('data:image/png;base64,QUJD');
    const secondFile = fetch.mock.calls[1]![1].body.get('file') as File;
    expect(Buffer.from(await secondFile.arrayBuffer())).toEqual(Buffer.from('ABC'));
    await client.disconnect();
  });
});
