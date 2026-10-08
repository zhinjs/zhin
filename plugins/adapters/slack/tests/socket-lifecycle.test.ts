import { EventEmitter } from 'node:events';
import { bindTestEndpoint } from '../../test-utils/endpoint.js';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { SlackEndpoint, type SlackSocketLike, type SlackWebClientLike } from '../src/endpoint.js';
import { resolveSlackConfig } from '../src/protocol.js';
import { slackSocketConnectionError } from '../src/socket-error.js';

it('shared lifecycle recreates SDK sockets, blocks stale callbacks and cancels reconnect on stop', async () => {
  vi.useFakeTimers();
  const sockets: Array<EventEmitter & { start: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
  const factory = vi.fn(() => {
    const socket = Object.assign(new EventEmitter(), { start: vi.fn(async () => {}), disconnect: vi.fn(async () => {}) });
    sockets.push(socket); return socket as unknown as SlackSocketLike;
  });
  const receive = vi.fn(async () => {});
  const endpoint = bindTestEndpoint(new SlackEndpoint({
    id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'slack'),
    config: resolveSlackConfig({ id: 'fixture', token: 'xoxb-fixture', appToken: 'xapp-fixture' }),
    createClient: () => ({ auth: { test: async () => ({ user_id: 'BOT' }) } }) as SlackWebClientLike,
    createSocket: factory,
  }), { receive, send: vi.fn(async () => 'fixture') }, undefined);
  try {
    await endpoint.start(); endpoint.open();
    expect(endpoint.transportState).toBe('open');
    expect(factory.mock.calls[0]).toEqual([expect.objectContaining({ autoReconnectEnabled: false })]);
    sockets[0]!.emit('disconnected');
    expect(endpoint.transportState).not.toBe('open');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets).toHaveLength(2);
    expect(endpoint.transportState).toBe('open');
    const ack = vi.fn(async () => {});
    sockets[0]!.emit('slack_event', { ack, body: {} });
    expect(ack).not.toHaveBeenCalled();
    expect(receive).not.toHaveBeenCalled();
    await endpoint.stop(); await vi.advanceTimersByTimeAsync(60_000);
    expect(endpoint.transportState).toBe('stopped');
    expect(sockets).toHaveLength(2);
    expect(sockets[1]!.disconnect).toHaveBeenCalled();
  } finally { await endpoint.stop(); vi.useRealTimers(); }
});

it('normalizes an undefined SDK startup rejection, cleans resources and permits a clean restart', async () => {
  const disconnect = vi.fn(async () => {});
  const socket = Object.assign(new EventEmitter(), { start: vi.fn().mockRejectedValueOnce(undefined).mockResolvedValue(undefined), disconnect });
  const endpoint = bindTestEndpoint(new SlackEndpoint({
    id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'slack'),
    config: resolveSlackConfig({ id: 'fixture', token: 'xoxb-fixture', appToken: 'xapp-fixture' }),
    createClient: () => ({ auth: { test: async () => ({ user_id: 'BOT' }) } }) as SlackWebClientLike,
    createSocket: () => socket as unknown as SlackSocketLike,
  }), { receive: vi.fn(async () => {}), send: vi.fn(async () => 'fixture') }, undefined);
  try {
    await expect(endpoint.start()).rejects.toThrow('SDK did not confirm a connection');
    expect(endpoint.transportState).toBe('stopped');
    expect(disconnect).toHaveBeenCalledTimes(1);
    await endpoint.start();
    expect(endpoint.transportState).toBe('open');
  } finally { await endpoint.stop(); }
});

it('retains only allowlisted connection reasons and never logs raw SDK URLs or tokens', () => {
  expect(slackSocketConnectionError({ message: 'wss://secret/?token=private', original: { code: 'ECONNREFUSED' } }).message).toBe('Slack Socket Mode connection failed (ECONNREFUSED)');
  expect(slackSocketConnectionError(new Error('wss://secret/?token=private')).message).not.toContain('private');
  expect(slackSocketConnectionError({ original: { message: 'Slack Stream proxy gateway identity changed; update fixed upstream before retrying' } }).message).toContain('fault proxy refused');
});
