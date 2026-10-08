import { EventEmitter } from 'node:events';
import { DingTalkStream, ROBOT_TOPIC } from '../src/stream.js';
import { resolveDingTalkConfig } from '../src/protocol.js';
class Socket extends EventEmitter {
  send = vi.fn(); ping = vi.fn(); terminate = vi.fn(() => this.emit('close'));
}
const config = resolveDingTalkConfig({ id: 'bot', appKey: 'key', appSecret: 'secret', mode: 'stream' });
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const register = (socket: Socket) => socket.emit('open');
const callback = (socket: Socket, id = 'one') => socket.emit('message', Buffer.from(JSON.stringify({ type: 'CALLBACK', headers: { topic: ROBOT_TOPIC, messageId: id }, data: JSON.stringify({ msgtype: 'text', msgId: id, text: { content: 'hello' } }) })));
it('waits for WSS open without requiring REGISTERED, gates admission, acknowledges and suppresses duplicate callbacks', async () => {
  const socket = new Socket(); const admit = vi.fn(async () => {}); let open = false;
  const fetch = vi.fn(async () => ({ ok: true, status: 200, text: async () => '', json: async () => ({ endpoint: 'wss://example.com', ticket: 'ticket' }) }));
  const stream = new DingTalkStream(config, fetch, admit, () => open, () => socket);
  const start = stream.start(); await flush(); expect(stream.lifecycle.state).toBe('connecting'); register(socket); await start;
  expect(stream.lifecycle.state).toBe('open'); callback(socket); await flush(); expect(admit).not.toHaveBeenCalled(); expect(socket.send).not.toHaveBeenCalled();
  open = true; callback(socket); await flush(); callback(socket); await flush(); expect(admit).toHaveBeenCalledTimes(1); expect(socket.send).toHaveBeenCalledTimes(2);
  expect(JSON.parse(socket.send.mock.calls[0][0])).toMatchObject({ code: 200, headers: { messageId: 'one' } });
  await stream.stop(); expect(stream.lifecycle.state).toBe('stopped');
});
it('cancels pending gateway without creating a late socket', async () => {
  let resolve!: (value: any) => void; const create = vi.fn(() => new Socket());
  const stream = new DingTalkStream(config, () => new Promise((r) => { resolve = r; }), async () => {}, () => true, create);
  const start = stream.start(); await flush(); await stream.stop(); await start;
  resolve({ ok: true, json: async () => ({ endpoint: 'wss://example.com', ticket: 'ticket' }) }); await flush(); expect(create).not.toHaveBeenCalled();
});
it('does not acknowledge handler failure and permits retry', async () => {
  const socket = new Socket(); const admit = vi.fn().mockRejectedValueOnce(new Error('failed')).mockResolvedValue(undefined);
  const stream = new DingTalkStream(config, async () => ({ ok: true, status: 200, text: async () => '', json: async () => ({ endpoint: 'wss://example.com', ticket: 'ticket' }) }), admit, () => true, () => socket);
  const start = stream.start(); await flush(); register(socket); await start; callback(socket); await flush(); expect(socket.send).not.toHaveBeenCalled(); callback(socket); await flush(); expect(socket.send).toHaveBeenCalledTimes(1); await stream.stop();
});
it('reports failed gateway and does not claim open', async () => {
  const stream = new DingTalkStream(config, async () => ({ ok: false, status: 401, text: async () => '', json: async () => ({}) }), async () => {}, () => true);
  await expect(stream.start()).rejects.toThrow('HTTP 401'); expect(stream.lifecycle.state).toBe('idle'); await stream.stop();
});
it('reconnects after close with a fresh gateway ticket and ignores stale callbacks', async () => {
  vi.useFakeTimers();
  try {
    const sockets: Socket[] = []; const admit = vi.fn(async () => {}); const fetch = vi.fn(async () => ({ ok: true, status: 200, text: async () => '', json: async () => ({ endpoint: 'wss://example.com', ticket: 'ticket' }) }));
    const stream = new DingTalkStream(config, fetch, admit, () => true, () => { const s = new Socket(); sockets.push(s); return s; });
    const start = stream.start(); await flush(); register(sockets[0]); await start; sockets[0].emit('close'); expect(stream.lifecycle.state).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(5300); expect(sockets).toHaveLength(2); register(sockets[1]); await flush(); expect(stream.lifecycle.state).toBe('open');
    callback(sockets[0]); await flush(); expect(admit).not.toHaveBeenCalled(); callback(sockets[1]); await flush(); expect(admit).toHaveBeenCalledTimes(1);
    await stream.stop(); await vi.advanceTimersByTimeAsync(100_000); expect(fetch).toHaveBeenCalledTimes(2);
  } finally { vi.useRealTimers(); }
});
it('subscribes card callbacks only with a template and acknowledges after successful admission', async () => {
  const socket = new Socket();
  const admitCard = vi.fn().mockRejectedValueOnce(new Error('not admitted')).mockResolvedValue(undefined);
  const fetch = vi.fn(async () => ({ ok: true, status: 200, text: async () => '', json: async () => ({ endpoint: 'wss://example.com', ticket: 'ticket' }) }));
  const stream = new DingTalkStream({ ...config, cardTemplateId: 'template' }, fetch, async () => {}, () => true, () => socket, admitCard);
  const start = stream.start(); await flush(); register(socket); await start;
  expect(JSON.parse((fetch.mock.calls as any)[0][1].body).subscriptions).toContainEqual({ type: 'CALLBACK', topic: '/v1.0/card/instances/callback' });
  const frame = Buffer.from(JSON.stringify({ type: 'CALLBACK', headers: { topic: '/v1.0/card/instances/callback', messageId: 'card-frame' }, data: JSON.stringify({ outTrackId: 'card', content: '{}' }) }));
  socket.emit('message', frame); await flush(); expect(socket.send).not.toHaveBeenCalled();
  socket.emit('message', frame); await flush(); expect(socket.send).toHaveBeenCalledTimes(1); expect(admitCard).toHaveBeenCalledTimes(2);
  expect(JSON.parse(socket.send.mock.calls[0][0])).toMatchObject({ code: 200, data: '{"response":null}' });
  await stream.stop();
});
