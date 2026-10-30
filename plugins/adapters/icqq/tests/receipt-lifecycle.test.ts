import { expect, it, vi } from 'vitest';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { icqqFixture } from './fixture.js';
import { createIcqqTestPorts } from './_icqq-mock.js';
import { resolveIcqqConfig } from '../src/protocol.js';

vi.mock('@icqqjs/icqq', async () => import('./_icqq-mock.js'));

it.each(['guild', 'request'] as const)('rejects closed %s callbacks before consuming their dedupe identity', async (kind) => {
  const receive = vi.fn(async () => undefined);
  const receiveRequest = vi.fn(async () => undefined);
  const ports = createIcqqTestPorts();
  const sideEvents = { ...ports.sideEvents, receiveRequest };
  const gateway = { receive, send: vi.fn(async () => 'sent') };
  const f = await icqqFixture({
    id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'icqq'),
    config: resolveIcqqConfig({ id: '10001', autoReconnect: false }),
    loginAssist: ports.loginAssist,
  }, gateway, sideEvents);
  await f.start(); f.open();
  const emit = () => {
    if (kind === 'guild') f.endpoint.emit('message.guild.normal', {
      type: 'guild', guild_id: 'g1', guild_name: 'Guild', channel_id: 'c1', channel_name: 'general',
      tiny_id: 'u1', nickname: 'Alice', message_id: 'same-guild', raw_message: 'accepted', time: 1700000000, seq: 7,
    });
    else f.endpoint.emit('request.friend.add', {
      post_type: 'request', request_type: 'friend', user_id: 20002, flag: 'same-request', time: 1700000000,
    });
  };
  try {
    await f.close();
    emit();
    await new Promise(resolve => setImmediate(resolve));
    expect(receive).not.toHaveBeenCalled();
    expect(receiveRequest).not.toHaveBeenCalled();
    f.open(); emit();
    await vi.waitFor(() => expect(kind === 'guild' ? receive : receiveRequest).toHaveBeenCalledOnce());
    emit();
    await new Promise(resolve => setImmediate(resolve));
    expect(kind === 'guild' ? receive : receiveRequest).toHaveBeenCalledOnce();
  } finally { await f.stop(); }
});
