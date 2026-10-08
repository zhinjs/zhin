import { RuntimeKookClient } from '../src/ws.js';
import { WebsocketReceiver } from 'kook-client';
import { EndpointDeliveryError } from '@zhin.js/im-contract';

it('does not infer online from SDK receiver state before lifecycle admission', () => {
  const client = new RuntimeKookClient({ token: 'fixture', mode: 'websocket', logLevel: 'off' });
  expect(client.getTransportState()).toBe('idle');
  expect(client.receiver).toBeInstanceOf(WebsocketReceiver);
  const receiver = client.receiver as WebsocketReceiver;
  receiver.state = WebsocketReceiver.State.Open;
  expect(client.getTransportState()).toBe('idle');
  receiver.state = WebsocketReceiver.State.Reconnection;
  expect(client.getTransportState()).toBe('idle');
  receiver.state = WebsocketReceiver.State.Closed;
  expect(client.getTransportState()).toBe('idle');
});

it.each(['legacy', 'typed'])('tolerates %s blacklist permission denial only during real SDK preload', async format => {
  const client = new RuntimeKookClient({ token: 'fixture', mode: 'websocket', logLevel: 'off' });
  const denied = format === 'legacy' ? new Error('request "/v3/blacklist/list" error with code(403): denied')
    : new EndpointDeliveryError('platform_rejected', 'KOOK HTTP request failed (status=403)', 'rejected');
  Object.assign(client, {
    getSelfInfo: async () => ({ id: 'bot', nickname: 'fixture' }),
    getGuildList: async () => [{ id: 'guild' }],
    getChannelList: async () => [], getGuildUserList: async () => [],
    request: { get: vi.fn(async () => { throw denied; }) },
  });
  await expect(client.init()).resolves.toBeUndefined();
  expect(client.guilds.has('guild')).toBe(true);
  await expect(client.getBlacklist('guild')).rejects.toBe(denied);
  client.request.get = vi.fn(async () => { throw new Error('network failure'); });
  await expect(client.init()).rejects.toThrow('network failure');
});

it.each([403, 500])('does not swallow other preload request failure status %i', async status => {
  const client = new RuntimeKookClient({ token: 'fixture', mode: 'websocket', logLevel: 'off' });
  const denied = new EndpointDeliveryError(status === 403 ? 'platform_rejected' : 'delivery_unconfirmed', `KOOK HTTP request failed (status=${status})`, status === 403 ? 'rejected' : 'unknown');
  client.getSelfInfo = vi.fn(async () => { throw denied; });
  await expect(client.init()).rejects.toBe(denied);
});
