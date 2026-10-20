import { afterEach, describe, expect, it, vi } from 'vitest';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { NapCatWssEndpoint } from '../src/wss-endpoint.js';
import { NapCatWsEndpoint } from '../src/ws-endpoint.js';
import { callNapCatWsAction } from '../src/ws-transport.js';
import { resolveNapCatConfig, type NapCatWsConfig } from '../src/protocol.js';
import type { NapCatWsSocket } from '../src/ws-types.js';

function socket() {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  return {
    readyState: 1,
    send: vi.fn<(data: string) => void>(), close: vi.fn(), ping: vi.fn(),
    on(event: string, listener: (...args: unknown[]) => void) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    },
    emit(event: string, ...args: unknown[]) {
      for (const listener of listeners.get(event) ?? []) listener(...args);
    },
  } satisfies NapCatWsSocket & { emit(event: string, ...args: unknown[]): void };
}
const config = resolveNapCatConfig({ connection: 'ws', id: 'fault-bot', url: 'ws://localhost:1234', access_token: 'test', reconnect_interval: 10, heartbeat_interval: 10 }) as NapCatWsConfig;
function endpoint(sockets: ReturnType<typeof socket>[]) {
  let next = 0;
  return new NapCatWsEndpoint({
    id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'napcat'), config,
    createWebSocket: () => { const ws = sockets[next++]!; queueMicrotask(() => ws.emit('open')); return ws; },
  });
}
const request = { conversation: { endpoint: { adapter: 'napcat', id: 'fault-bot' }, kind: 'private' as const, id: '123' }, payload: 'hello' };
afterEach(() => vi.useRealTimers());
describe('napcat transport fault ownership', () => {
  it('cleans pending actions and timers when send throws synchronously', async () => {
    vi.useFakeTimers();
    const ws = socket();
    ws.send.mockImplementation(() => { throw new Error('send failed'); });
    const pending = new Map();
    await expect(callNapCatWsAction(ws, pending, { value: 0 }, 'send_private_msg', {})).rejects.toThrow('send failed');
    expect(pending.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(ws.send).toHaveBeenCalledTimes(1);
  });
  it('rejects interrupted sends immediately and isolates retired sockets after reconnect', async () => {
    vi.useFakeTimers();
    const old = socket(), current = socket();
    const bot = endpoint([old, current]);
    await bot.start(); bot.open();
    const sending = bot.send(request);
    const rejected = expect(sending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(0);
    old.emit('close', 1006, 'offline'); await rejected;
    expect(old.send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10); current.emit('open'); await vi.advanceTimersByTimeAsync(0);
    expect(bot.transportState).toBe('open');
    const send = bot.send(request);
    await vi.advanceTimersByTimeAsync(0);
    const echo = JSON.parse(current.send.mock.calls[0]![0]).echo;
    old.emit('message', JSON.stringify({ echo, status: 'ok', retcode: 0, data: { message_id: 99 } }));
    old.emit('close', 1006, 'late');
    expect(bot.transportState).toBe('open');
    current.emit('message', JSON.stringify({ echo, status: 'ok', retcode: 0, data: { message_id: 42 } }));
    await expect(send).resolves.toBe('42');
    await bot.stop();
  });
  it('retires half-open transport without retrying an in-flight message', async () => {
    vi.useFakeTimers();
    const ws = socket(); const bot = endpoint([ws]);
    await bot.start();
    const sending = bot.send(request);
    const rejected = expect(sending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(30); await rejected;
    expect(bot.transportState).toBe('closed');
    expect(ws.close).toHaveBeenCalledOnce();
    expect(ws.send).toHaveBeenCalledOnce();
    await expect(bot.send(request)).rejects.toThrow();
    await bot.stop();
  });
  it('keeps an idle live transport open when pong acknowledges heartbeats', async () => {
    vi.useFakeTimers();
    const ws = socket(); const bot = endpoint([ws]);
    await bot.start();
    for (let i = 0; i < 8; i++) { await vi.advanceTimersByTimeAsync(10); ws.emit('pong'); }
    expect(bot.transportState).toBe('open'); expect(ws.close).not.toHaveBeenCalled();
    await bot.stop();
  });
  it('rejects missing platform receipts without resending', async () => {
    const ws = socket(); const bot = endpoint([ws]);
    await bot.start();
    const send = bot.send(request);
    await vi.waitFor(() => expect(ws.send).toHaveBeenCalled());
    const echo = JSON.parse(ws.send.mock.calls[0]![0]).echo;
    ws.emit('message', JSON.stringify({ echo, status: 'ok', retcode: 0, data: {} }));
    await expect(send).rejects.toThrow('delivery is unconfirmed');
    expect(ws.send).toHaveBeenCalledOnce(); await bot.stop();
  });
});

  it('isolates reverse replacement receipts and settles disconnected actions', async () => {
    vi.useFakeTimers();
    let accept!: (connection: unknown) => void;
    const http = { ws: () => ({ onConnection(fn: typeof accept) { accept = fn; return vi.fn(); } }) };
    const bot = new NapCatWssEndpoint({ id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'napcat'), http: http as never,
      config: resolveNapCatConfig({ connection: 'wss', id: 'reverse', path: '/test', access_token: 'test', heartbeat_interval: 10 }) as never });
    const connect = (ws: ReturnType<typeof socket>) => accept({ socket: ws, request: { headers: { authorization: 'Bearer test' }, url: '/', socket: { remoteAddress: '127.0.0.1' } } });
    const first = socket(), second = socket();
    await bot.start(); connect(first); await vi.advanceTimersByTimeAsync(0);
    expect(bot.transportState).toBe('open');
    const initial = bot.send(request); const rejected = expect(initial).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(0); connect(second); await vi.advanceTimersByTimeAsync(0); await rejected;
    const next = bot.send(request); await vi.advanceTimersByTimeAsync(0);
    const echo = JSON.parse(second.send.mock.calls[0]![0]).echo;
    first.emit('message', JSON.stringify({ echo, status: 'ok', retcode: 0, data: { message_id: 99 } }));
    first.emit('close'); expect(bot.transportState).toBe('open');
    second.emit('message', JSON.stringify({ echo, status: 'ok', retcode: 0, data: { message_id: 88 } }));
    await expect(next).resolves.toBe('88');
    const interrupted = bot.send(request); const interruptedRejection = expect(interrupted).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(0); second.emit('close'); await interruptedRejection;
    expect(second.send).toHaveBeenCalledTimes(2); await bot.stop(); expect(bot.transportState).toBe('stopped');
  });

it('keeps two simultaneous account action maps isolated despite identical echo counters', async () => {
  const left = socket(), right = socket();
  const first = endpoint([left]), second = endpoint([right]);
  await Promise.all([first.start(), second.start()]);
  const sendingLeft = first.send(request), sendingRight = second.send(request);
  await vi.waitFor(() => expect(right.send).toHaveBeenCalled());
  const echo = JSON.parse(right.send.mock.calls[0]![0]).echo;
  expect(JSON.parse(left.send.mock.calls[0]![0]).echo).toBe(echo);
  right.emit('message', JSON.stringify({ echo, status: 'ok', retcode: 0, data: { message_id: 2 } }));
  await expect(sendingRight).resolves.toBe('2');
  left.emit('message', JSON.stringify({ echo, status: 'ok', retcode: 0, data: { message_id: 1 } }));
  await expect(sendingLeft).resolves.toBe('1');
  await Promise.all([first.stop(), second.stop()]);
});

it('hands off the first frame in the same turn as socket open', async () => {
  const ws = socket();
  const bot = new NapCatWsEndpoint({ id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'napcat'), config,
    createWebSocket: () => { queueMicrotask(() => {
      ws.emit('open');
      ws.emit('message', JSON.stringify({ post_type: 'message', message_type: 'private', message_id: 111, user_id: 123, message: 'first' }));
    }); return ws; } });
  const handoff = vi.spyOn(bot, 'admit');
  await bot.start(); expect(handoff).toHaveBeenCalledOnce(); await bot.stop();
});

it('serializes concurrent reverse replacements and refuses connections queued during stop', async () => {
  vi.useFakeTimers();
  let accept!: (connection: unknown) => void;
  const http = { ws: () => ({ onConnection(fn: typeof accept) { accept = fn; return vi.fn(); } }) };
  const bot = new NapCatWssEndpoint({ id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'napcat'), http: http as never,
    config: resolveNapCatConfig({ connection: 'wss', id: 'reverse', path: '/test', access_token: 'test', heartbeat_interval: 10 }) as never });
  const connect = (ws: ReturnType<typeof socket>) => accept({ socket: ws, request: { headers: { authorization: 'Bearer test' }, url: '/', socket: { remoteAddress: '127.0.0.1' } } });
  const first = socket(), second = socket(), third = socket();
  await bot.start(); connect(first); connect(second); connect(third); await vi.advanceTimersByTimeAsync(0);
  expect(first.close).toHaveBeenCalledOnce(); expect(second.close).toHaveBeenCalledOnce(); expect(third.close).not.toHaveBeenCalled();
  const late = socket(); connect(late); const stopping = bot.stop(); await stopping;
  expect(third.close).toHaveBeenCalledOnce(); expect(late.close).toHaveBeenCalledOnce();
  expect(bot.transportState).toBe('stopped'); expect(vi.getTimerCount()).toBe(0);
});

it('preserves a zero platform message id without imposing an undocumented range', async () => {
  const ws = socket(); const bot = endpoint([ws]); await bot.start();
  const sending = bot.send(request); await vi.waitFor(() => expect(ws.send).toHaveBeenCalled());
  const echo = JSON.parse(ws.send.mock.calls[0]![0]).echo;
  ws.emit('message', JSON.stringify({ echo, status: 'ok', retcode: 0, data: { message_id: 0 } }));
  await expect(sending).resolves.toBe('0'); await bot.stop();
});

it('owns initial connection refusal and resets lifecycle without orphan rejection', async () => {
  const ws = socket();
  const refused = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
  const bot = new NapCatWsEndpoint({ id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'napcat'), config,
    createWebSocket: () => { queueMicrotask(() => { ws.emit('error', refused); ws.emit('close', 1006, ''); }); return ws; } });
  await expect(bot.start()).rejects.toBe(refused);
  expect(bot.transportState).toBe('idle');
  await bot.stop(); await new Promise(resolve => setImmediate(resolve));
  expect(bot.transportState).toBe('stopped');
});
