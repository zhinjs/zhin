import { expect, it, vi } from 'vitest';
import { discordFixture } from './fixture.js';
import { DiscordGatewayEndpoint } from '../src/endpoint.js';
import { resolveDiscordConfig, type ResolvedDiscordGatewayConfig } from '../src/protocol.js';
const gate = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };

it.each(['close', 'stop'] as const)('owns a parallel native Discord ACK across %s without delaying business dispatch', async action => {
  const ack = gate(), receive = vi.fn(async () => undefined), destroyed = vi.fn(async () => { ack.resolve(); });
  const f = await discordFixture(() => new DiscordGatewayEndpoint({ id: 'discord-ack' as never,
    config: resolveDiscordConfig({ id: 'bot', token: 'synthetic', connection: 'gateway' }) as ResolvedDiscordGatewayConfig }),
  () => ({ login: async () => undefined, destroy: destroyed }), { receive });
  const endpoint = f.endpoint;
  if (!(endpoint instanceof DiscordGatewayEndpoint)) throw new Error('Expected the native Gateway Client');
  await f.start(); f.open();
  const deferUpdate = vi.fn(() => ack.promise);
  const raw = { isButton: () => true, deferUpdate, id: 'click', customId: 'confirm', channelId: 'channel',
    createdTimestamp: 1700000000000, user: { id: 'user', username: 'Alice' }, message: { id: 'source' } };
  Reflect.apply(endpoint.emit, endpoint, ['interactionCreate', raw]);
  await vi.waitFor(() => expect(receive).toHaveBeenCalledOnce());
  expect(deferUpdate).toHaveBeenCalledOnce();
  let complete = false;
  const closing = (action === 'close' ? f.close() : f.stop()).then(() => { complete = true; });
  try {
    if (action === 'close') {
      await new Promise(resolve => setImmediate(resolve)); expect(complete).toBe(false);
      expect(destroyed).not.toHaveBeenCalled(); ack.resolve(); await closing;
    } else { await closing; expect(destroyed).toHaveBeenCalledOnce(); }
    const late = vi.fn(async () => undefined);
    Reflect.apply(endpoint.emit, endpoint, ['interactionCreate', { ...raw, id: 'late', deferUpdate: late }]);
    await new Promise(resolve => setImmediate(resolve)); expect(late).not.toHaveBeenCalled();
    expect(receive).toHaveBeenCalledOnce();
  } finally { ack.resolve(); await closing; await f.stop(); }
});
