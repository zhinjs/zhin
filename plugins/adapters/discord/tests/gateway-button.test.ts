import { EventEmitter } from 'node:events';
import { getLogger } from '@zhin.js/logger';
import { connectDiscordGatewayClient, type DiscordClientTransport } from '../src/gateway.js';
import { resolveDiscordConfig, type ResolvedDiscordGatewayConfig } from '../src/protocol.js';

it.each([null, 'guild'])('admits a button when channel cache is empty (guild %s)', async guildId => {
  const events = new EventEmitter();
  const client = Object.assign(events, { login: async () => { queueMicrotask(() => events.emit('clientReady')); return 'fixture'; }, user: { id: 'bot' } }) as unknown as DiscordClientTransport;
  const onButton = vi.fn();
  await connectDiscordGatewayClient(client, resolveDiscordConfig({ id: 'test', token: 'fixture', connection: 'gateway' }) as ResolvedDiscordGatewayConfig, { onPlatformEvent: vi.fn(), onMessage: vi.fn(), onButton, onGuildMemberAdd: vi.fn(), onGuildMemberRemove: vi.fn() });
  const deferUpdate = vi.fn(async () => undefined);
  events.emit('interactionCreate', { isButton: () => true, deferUpdate, id: 'click', customId: 'callback', channel: null, channelId: 'channel', guildId, user: { id: 'user', username: 'Tester' }, message: { id: 'source' } });
  expect(deferUpdate).toHaveBeenCalledTimes(1);
  expect(onButton).toHaveBeenCalledWith({ id: 'click', customId: 'callback', channelId: 'channel', channelKind: guildId ? 'channel' : 'private', userId: 'user', userName: 'Tester', ...(guildId ? { guildId } : {}), sourceMessageId: 'source' });
});
it('reports callback ACK failure without token-bearing error payload', async () => {
  const events = new EventEmitter();
  const client = Object.assign(events, { login: async () => { queueMicrotask(() => events.emit('clientReady')); return 'fixture'; }, user: { id: 'bot' } }) as unknown as DiscordClientTransport;
  const warn = vi.spyOn(getLogger('discord'), 'warn');
  try {
    await connectDiscordGatewayClient(client, resolveDiscordConfig({ id: 'test', token: 'fixture', connection: 'gateway' }) as ResolvedDiscordGatewayConfig, { onPlatformEvent: vi.fn(), onMessage: vi.fn(), onButton: vi.fn(), onGuildMemberAdd: vi.fn(), onGuildMemberRemove: vi.fn() });
    events.emit('interactionCreate', { isButton: () => true, deferUpdate: async () => { throw new Error('https://discord.com/api/interactions/id/SECRET-TOKEN/callback'); }, id: 'click', customId: 'callback', channel: { id: 'channel', type: 0 }, user: { id: 'user' } });
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    expect(JSON.stringify(warn.mock.calls)).toContain('discord_gateway_button_ack');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('SECRET-TOKEN');
  } finally { warn.mockRestore(); }
});
