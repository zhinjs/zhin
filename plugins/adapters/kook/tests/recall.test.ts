import { Client } from 'kook-client';
import { recallKookMessage } from '../src/outbound.js';
import type { KookClientTransport } from '../src/ws.js';
const conversation = { endpoint: { id: 'bot', adapter: 'kook' }, kind: 'channel' as const, id: 'target' };
describe('KOOK honest deletion', () => {
  it.each(['channel', 'private'] as const)('uses actual SDK %s delete API and original routing', async (kind) => {
    const client = new Client({ token: 'fixture', mode: 'websocket' });
    client.channels.set('target', { id: 'target' } as never);
    client.users.set('target', { id: 'target' } as never);
    const post = vi.spyOn(client.request, 'post').mockResolvedValue({ code: 0 } as never);
    try {
      await recallKookMessage(client as unknown as KookClientTransport, { id: 'msg', conversation: { ...conversation, kind } });
      expect(post).toHaveBeenCalledWith(kind === 'private' ? '/v3/direct-message/delete' : '/v3/message/delete', { msg_id: 'msg' });
    } finally { await client.disconnect(); vi.restoreAllMocks(); }
  });
  it('rejects missing transport method instead of optional no-op', async () => {
    await expect(recallKookMessage({} as KookClientTransport, { id: 'msg', conversation })).rejects.toMatchObject({ code: 'unsupported_operation', disposition: 'rejected' });
  });
  it('rejects false platform acknowledgement and preserves uncertain network', async () => {
    const recallChannelMsg = vi.fn(async () => false);
    const client = { recallChannelMsg } as unknown as KookClientTransport;
    await expect(recallKookMessage(client, { id: 'msg', conversation })).rejects.toMatchObject({ disposition: 'rejected' });
    recallChannelMsg.mockRejectedValue(new Error('socket reset'));
    await expect(recallKookMessage(client, { id: 'msg', conversation })).rejects.toMatchObject({ disposition: 'unknown' });
    expect(recallChannelMsg).toHaveBeenCalledTimes(2);
  });
});
