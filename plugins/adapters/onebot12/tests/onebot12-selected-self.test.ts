import WebSocket, { WebSocketServer } from 'ws';
import { describe, expect, it, vi } from 'vitest';
import { createHttpHost, httpHostToken } from '@zhin.js/host-http';
import { createAdapterHarness, createTestEndpointEventGateway } from '../../test-utils/endpoint.js';
import definition from '../adapters/onebot12/index.js';
import { Onebot12Client } from '../src/client.js';
import { resolveOneBot12Config } from '../src/protocol.js';

const self = { platform: 'qq', user_id: 'selected' };
const incoming = (selected: typeof self, id: string) => ({ id, time: 1, type: 'message', detail_type: 'group', sub_type: '', self: selected,
  group_id: 'same-group', user_id: '42', message_id: id, alt_message: id, message: [{ type: 'text', data: { text: id } }] });
describe('OneBot12 selected account at the actual protocol boundaries', () => {
  it.each(['ws', 'wss', 'webhook'] as const)('%s filters before SDK ingest and carries fixed top-level self for native actions', async connection => {
    const actions: Array<Record<string, unknown>> = [], messages: unknown[] = [];
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    const server = connection === 'ws' ? new WebSocketServer({ port: 0, host: '127.0.0.1' }) : undefined;
    let peer: WebSocket | undefined;
    const respond = (socket: WebSocket) => socket.on('message', raw => {
      const request = JSON.parse(String(raw)) as Record<string, unknown>; actions.push(request);
      socket.send(JSON.stringify({ status: 'ok', retcode: 0, echo: request.echo, data: { user_id: 'selected' } }));
    });
    if (server) { server.on('connection', socket => { peer = socket; respond(socket); }); await new Promise<void>(resolve => server.once('listening', resolve)); }
    const address = server?.address();
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>(async (input, init) => {
      if (String(input) !== 'https://offline.invalid/actions') return realFetch(input, init);
      actions.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ status: 'ok', retcode: 0, message: '', data: { user_id: 'selected' } }));
    }));
    const config = { id: 'configured-name', platform: 'qq', userId: 'selected', connection, path: '/onebot/selected', api_url: 'https://offline.invalid/actions',
      url: address && typeof address !== 'string' ? `ws://127.0.0.1:${address.port}` : undefined };
    const h = await createAdapterHarness(definition, config, { name: 'onebot12', resources: new Map([[httpHostToken.id, http]]),
      gateway: createTestEndpointEventGateway({ async receive(event) { if (event.name === 'message.receive') messages.push(event.payload); } }) });
    let port = 0;
    try {
      await h.start(); h.open();
      const endpoint = h.endpoint; if (!(endpoint instanceof Onebot12Client)) throw new Error('Actual OneBot12 SDK Client is missing');
      const raw = vi.fn(); endpoint.on('event', raw);
      if (connection !== 'ws') {
        port = (await http.listen()).port;
        if (connection === 'wss') { peer = new WebSocket(`ws://127.0.0.1:${port}/onebot/selected`); respond(peer);
          await new Promise<void>((resolve, reject) => { peer!.once('open', resolve); peer!.once('error', reject); }); }
      }
      const send = async (event: unknown) => {
        if (connection === 'webhook') {
          const response = await realFetch(`http://127.0.0.1:${port}/onebot/selected`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(event) });
          expect(response.status).toBe(200);
        } else peer!.send(JSON.stringify(event));
      };
      await send(incoming({ platform: 'qq', user_id: 'other' }, 'foreign-user'));
      await send(incoming({ platform: 'discord', user_id: 'selected' }, 'foreign-platform'));
      await send(incoming(self, 'selected-message'));
      await vi.waitFor(() => expect(messages).toHaveLength(1));
      expect(raw).toHaveBeenCalledOnce();
      const message = messages[0]; if (!message || typeof message !== 'object' || !('event' in message)) throw new Error('Canonical selected event is missing');
      expect(message.event).toBe(raw.mock.calls[0]![0]); expect(message).toMatchObject({ content: 'selected-message', sender: { id: '42' } });
      expect(h.index.connection('onebot12', h.canonicalId)?.selfUserId).toBe('selected');
      await endpoint.call('get_self_info', { self: { platform: 'forged', user_id: 'forged' } });
      expect(actions).toHaveLength(1); expect(actions[0]).toMatchObject({ action: 'get_self_info', self });
      expect(actions[0]?.params).toEqual({ self: { platform: 'forged', user_id: 'forged' } });
      expect(endpoint.start).toBe(Onebot12Client.prototype.start); expect(endpoint.acceptHttp).toBe(Onebot12Client.prototype.acceptHttp);
    } finally {
      peer?.terminate(); await h.stop(); await http.close(); vi.unstubAllGlobals();
      if (server) { for (const client of server.clients) client.terminate(); await new Promise<void>(resolve => server.close(() => resolve())); }
    }
  });
  it('requires platform and userId independently of the configured endpoint name', () => {
    const config = { id: 'display-name', platform: 'qq', userId: 'selected', url: 'ws://localhost' };
    expect(() => resolveOneBot12Config({ ...config, platform: '' })).toThrow('platform');
    expect(() => resolveOneBot12Config({ ...config, userId: '' })).toThrow('userId');
  });
});
