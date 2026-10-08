import { EventEmitter } from 'node:events';
import { RuntimeKookClient } from '../src/ws.js';

it('unified lifecycle reconnects the actual SDK receiver and stop cancels future connections', async () => {
  vi.useFakeTimers();
  const sockets: Array<EventEmitter & { readyState: number; send: ReturnType<typeof vi.fn>; terminate: ReturnType<typeof vi.fn> }> = [];
  const factory = vi.fn((url: string) => {
    const socket = Object.assign(new EventEmitter(), { readyState: 1, send: vi.fn(), terminate: vi.fn() });
    sockets.push(socket);
    queueMicrotask(() => {
      socket.emit('message', Buffer.from(JSON.stringify({ s: 1, d: { code: 0, session_id: 'fixture' } })));
      if (new URL(url).searchParams.get('resume') === '1') socket.emit('message', Buffer.from(JSON.stringify({ s: 6, d: { session_id: 'fixture' } })));
    });
    return socket;
  });
  const handlers = process.listeners('uncaughtException');
  const client = new RuntimeKookClient({ token: 'fixture', mode: 'websocket', logLevel: 'off', socketFactory: factory } as ConstructorParameters<typeof RuntimeKookClient>[0]);
  expect(process.listeners('uncaughtException')).toEqual(handlers);
  vi.spyOn(client.request, 'get').mockResolvedValue({ data: { url: 'wss://gateway.test/?ticket=fixture' } });
  vi.spyOn(client, 'init').mockResolvedValue(undefined);
  try {
    await client.connect();
    expect(client.getTransportState()).toBe('open');
    sockets[0]!.emit('close', 1006, Buffer.from('fixture'));
    expect(client.getTransportState()).not.toBe('open');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets).toHaveLength(2);
    expect(client.getTransportState()).toBe('open');
    await client.disconnect();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets).toHaveLength(2);
    expect(client.getTransportState()).toBe('stopped');
    expect(process.listeners('uncaughtException')).toEqual(handlers);
  } finally { await client.disconnect(); vi.useRealTimers(); }
});
