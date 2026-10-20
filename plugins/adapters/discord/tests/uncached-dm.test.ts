import { Client, GatewayIntentBits } from 'discord.js';
import { defaultCreateClient, normalizeDiscordMessage } from '../src/gateway.js';

it('emits and normalizes the first DM before its channel has been cached', async () => {
  const client = defaultCreateClient([GatewayIntentBits.DirectMessages]) as unknown as Client;
  const received = vi.fn();
  client.on('messageCreate', received);
  try {
    expect(client.channels.cache.size).toBe(0);
    // Exercise the real SDK gateway action without login or network traffic.
    (client as any).actions.MessageCreate.handle({
      id: '100000000000000001', channel_id: '100000000000000002', channel_type: 1, type: 0,
      author: { id: '100000000000000003', username: 'fixture', discriminator: '0', bot: false },
      content: '/acceptance probe:sample0004', timestamp: '2026-09-30T00:00:00Z',
      attachments: [], embeds: [], mentions: [], mention_roles: [], pinned: false, tts: false,
    });
    expect(received).toHaveBeenCalledTimes(1);
    expect(normalizeDiscordMessage(received.mock.calls[0][0])).toMatchObject({
      channelKind: 'private', channelId: '100000000000000002', content: '/acceptance probe:sample0004',
    });
  } finally { await client.destroy(); }
});
