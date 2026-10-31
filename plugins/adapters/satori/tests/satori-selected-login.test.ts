import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { createAdapterHarness, createTestEndpointEventGateway } from '../../test-utils/endpoint.js';
import definition from '../adapters/satori/index.js';
import { SatoriClient } from '../src/client.js';
import { resolveSatoriConfig } from '../src/protocol.js';

it('selects the configured login before SDK ingest and fixes API headers independently of READY ordering', async () => {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' }); let socket: WebSocket | undefined;
  server.on('connection', peer => { socket = peer; });
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing local Satori peer');
  const received: unknown[] = [], requests: Headers[] = [];
  vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>(async (_url, init) => { requests.push(new Headers(init?.headers)); return new Response(JSON.stringify([{ id: 'created' }])); }));
  const h = await createAdapterHarness(definition, { id: 'configured', platform: 'qq', userId: 'target', baseUrl: `http://127.0.0.1:${address.port}` },
    { name: 'satori', gateway: createTestEndpointEventGateway({ async receive(event) { if (event.name === 'message.receive') received.push(event.payload); } }) });
  try {
    await h.start(); h.open();
    const endpoint = h.endpoint; if (!(endpoint instanceof SatoriClient)) throw new Error('Expected actual Satori SDK Client');
    const raw = vi.fn(); endpoint.on('event', raw);
    const login = (platform: string, id: string) => ({ platform, user: { id }, status: 1 });
    socket!.send(JSON.stringify({ op: 4, body: { logins: [login('discord', 'foreign-first'), login('qq', 'target')] } }));
    const event = (platform: string, id: string, messageId: string) => ({ op: 0, body: { type: 'message-created', login: login(platform, id),
      channel: { id: 'same-room', type: 0 }, guild: { id: 'same-parent' }, user: { id: '42' }, message: { id: messageId, content: messageId } } });
    socket!.send(JSON.stringify(event('qq', 'other-user', 'foreign-user')));
    socket!.send(JSON.stringify(event('discord', 'target', 'foreign-platform')));
    socket!.send(JSON.stringify(event('qq', 'target', 'selected')));
    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(raw).toHaveBeenCalledOnce(); expect(received[0]).toMatchObject({ content: 'selected', sender: { id: '42' }, conversation: { id: 'same-room' } });
    const message = received[0]; if (!message || typeof message !== 'object' || !('event' in message)) throw new Error('Missing canonical event');
    expect(message.event).toBe(raw.mock.calls[0]![0]);
    expect(h.index.connection('satori', h.canonicalId)?.selfUserId).toBe('target');
    await endpoint.call('message', 'create', { channel_id: 'same-room', content: 'outbound' });
    expect(requests).toHaveLength(1); expect(requests[0]?.get('Satori-Platform')).toBe('qq'); expect(requests[0]?.get('Satori-User-ID')).toBe('target');
    expect(endpoint.start).toBe(SatoriClient.prototype.start); expect(endpoint.stop).toBe(SatoriClient.prototype.stop);
  } finally {
    await h.stop(); vi.unstubAllGlobals(); for (const peer of server.clients) peer.terminate(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
it('requires both selector fields in resolved configuration and the shipped schema', () => {
  const base = { id: 'satori', baseUrl: 'http://localhost', platform: 'qq', userId: 'target' };
  expect(() => resolveSatoriConfig({ ...base, platform: '' })).toThrow('platform');
  expect(() => resolveSatoriConfig({ ...base, userId: '' })).toThrow('userId');
  const schema = JSON.parse(readFileSync(new URL('../schema.json', import.meta.url), 'utf8'));
  expect(schema.properties.endpoints.items.required).toEqual(expect.arrayContaining(['platform', 'userId']));
});
