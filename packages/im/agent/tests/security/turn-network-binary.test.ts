import { EventEmitter } from 'node:events';
import type { ToolInvocationPolicy } from '@zhin.js/tool';
import { NodeNetworkTransport, TurnNetworkClient, type NetworkTransport } from '../../src/security/turn-network-client.js';

const mocked = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: mocked.lookup }));
vi.mock('node:https', () => ({ request: mocked.request }));

const policy: ToolInvocationPolicy = { permissions: ['master'], unattended: false,
  network: { enabled: true, httpsOnly: true, allowedDomains: ['images.example.test'] } };

beforeEach(() => {
  vi.clearAllMocks();
  mocked.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
});

function response(bytes: Uint8Array, pending = false) {
  mocked.request.mockImplementation((options, receive) => {
    const request = new EventEmitter() as EventEmitter & { end(): void };
    request.end = () => {
      const incoming = new EventEmitter() as EventEmitter & { headers: object; statusCode: number; statusMessage: string; destroy(error: Error): void };
      incoming.headers = { 'content-type': 'image/png' }; incoming.statusCode = 200; incoming.statusMessage = 'OK';
      incoming.destroy = error => { incoming.emit('error', error); };
      receive(incoming);
      options.signal.addEventListener('abort', () => request.emit('error', options.signal.reason), { once: true });
      if (!pending) queueMicrotask(() => { incoming.emit('data', Buffer.from(bytes)); incoming.emit('end'); });
    };
    return request;
  });
}

it('returns exact binary bytes through the same pinned DNS, SNI and Host authority', async () => {
  const bytes = Uint8Array.from([0, 255, 128, 13, 10]); response(bytes);
  const result = await new TurnNetworkClient(policy, new AbortController().signal).getBytes('https://images.example.test/avatar.png', { maxBytes: 10 });
  expect([...result.body]).toEqual([...bytes]);
  expect(mocked.lookup).toHaveBeenCalledWith('images.example.test', { all: true, verbatim: true });
  expect(mocked.request.mock.calls[0]?.[0]).toMatchObject({ hostname: '93.184.216.34', servername: 'images.example.test', headers: { Host: 'images.example.test' } });
});

it('rejects oversized binary bodies at the transport instead of materializing them into a tool result', async () => {
  response(Uint8Array.from([1, 2, 3, 4]));
  await expect(new TurnNetworkClient(policy, new AbortController().signal).getBytes('https://images.example.test/avatar.png', { maxBytes: 3 }))
    .rejects.toThrow('exceeds 3 bytes');
});

it('rejects private DNS before opening a binary socket', async () => {
  mocked.lookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
  await expect(new NodeNetworkTransport().requestBytes(new URL('https://images.example.test/avatar'), {}, new AbortController().signal, 10))
    .rejects.toMatchObject({ name: 'NetworkAccessDeniedError' });
  expect(mocked.request).not.toHaveBeenCalled();
});

it('reauthorizes a binary redirect and refuses an unapproved domain before its next hop', async () => {
  const requestBytes = vi.fn<NonNullable<NetworkTransport['requestBytes']>>(async () => ({ status: 302, statusText: 'Found', headers: { location: 'https://foreign.example.test/private' }, body: new Uint8Array() }));
  await expect(new TurnNetworkClient(policy, new AbortController().signal, { request: vi.fn(), requestBytes })
    .getBytes('https://images.example.test/start')).rejects.toMatchObject({ name: 'NetworkAccessDeniedError' });
  expect(requestBytes).toHaveBeenCalledTimes(1);
});

it('propagates caller cancellation to the active pinned binary request without retry', async () => {
  response(Uint8Array.from([1]), true);
  const abort = new AbortController();
  const pending = new TurnNetworkClient(policy, abort.signal).getBytes('https://images.example.test/avatar');
  await vi.waitFor(() => expect(mocked.request).toHaveBeenCalledTimes(1));
  abort.abort(new Error('turn stopped'));
  await expect(pending).rejects.toThrow('turn stopped');
  expect(mocked.request).toHaveBeenCalledTimes(1);
});
