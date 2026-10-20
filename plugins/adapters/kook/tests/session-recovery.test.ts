import { EventEmitter } from 'node:events';
import { Client, WebsocketReceiver } from 'kook-client';

const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

it('actual SDK preserves sequential sn for original-URL resume, waits ACK, and resets on server reconnect before fresh session', async () => {
  const sockets: Array<EventEmitter & { readyState: number; send: ReturnType<typeof vi.fn>; terminate: ReturnType<typeof vi.fn> }> = [];
  const urls: URL[] = [];
  const socketFactory = vi.fn((url: string) => {
    urls.push(new URL(url));
    const socket = Object.assign(new EventEmitter(), { readyState: 1, send: vi.fn(), terminate: vi.fn() }); sockets.push(socket);
    queueMicrotask(() => socket.emit('message', Buffer.from(JSON.stringify({ s: 1, d: { code: 0, session_id: sockets.length < 3 ? 'session-a' : 'session-b' } }))));
    return socket;
  });
  const client = new Client({ token: 'fixture', mode: 'websocket', autoReconnect: false, handleProcessErrors: false, socketFactory: socketFactory as never, logLevel: 'off' });
  const discovery = vi.spyOn(client.request, 'get').mockResolvedValue({ data: { url: 'wss://gateway.test/?ticket=fixture' } });
  vi.spyOn(client, 'init').mockResolvedValue(undefined);
  const receiver = client.receiver as WebsocketReceiver;
  const sequence: number[] = [];
  receiver.on('event', () => sequence.push(receiver.sn));
  const frame = (socket: EventEmitter, s: number, d: unknown, sn?: number) => socket.emit('message', Buffer.from(JSON.stringify({ s, d, sn })));
  const event = (id: number) => ({ channel_type: 'GROUP', type: 1, target_id: 'channel', author_id: 'actor', content: `fixture-${id}`, msg_id: `id-${id}`, msg_timestamp: id, extra: { type: 1, author: { id: 'actor', nickname: 'fixture', bot: false } } });
  try {
    await client.connect();
    frame(sockets[0]!, 0, event(1), 1); frame(sockets[0]!, 0, event(2), 2);
    expect(sequence).toEqual([1, 2]);
    sockets[0]!.emit('close', 1006, Buffer.from('fixture'));
    expect(receiver.canResume()).toBe(true);
    const resumed = receiver.connect(true); await flush();
    expect(urls[1]!.searchParams.get('resume')).toBe('1');
    expect(urls[1]!.searchParams.get('sn')).toBe('2');
    expect(urls[1]!.searchParams.get('session_id')).toBe('session-a');
    expect(discovery).toHaveBeenCalledTimes(1);
    expect(receiver.state).not.toBe(WebsocketReceiver.State.Open);
    frame(sockets[1]!, 6, { session_id: 'session-a' }); await resumed;
    expect(receiver.state).toBe(WebsocketReceiver.State.Open);
    expect(JSON.parse(sockets[1]!.send.mock.calls[0]![0]).sn).toBe(2);
    frame(sockets[1]!, 0, event(3), 3);
    expect(sequence).toEqual([1, 2, 3]);
    frame(sockets[1]!, 5, { code: 40108 });
    expect(receiver.canResume()).toBe(false);
    expect(receiver.sn).toBe(0);
    expect(receiver.buffer).toEqual([]);
    await client.connect();
    expect(discovery).toHaveBeenCalledTimes(2);
    expect(urls[2]!.searchParams.has('resume')).toBe(false);
    expect(JSON.parse(sockets[2]!.send.mock.calls[0]![0]).sn).toBe(0);
    frame(sockets[2]!, 0, event(4), 1);
    expect(sequence).toEqual([1, 2, 3, 1]);
  } finally { await client.disconnect(); }
});
