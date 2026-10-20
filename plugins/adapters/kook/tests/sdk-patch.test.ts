import { EventEmitter } from 'node:events';
import { loadPublishedKookFixture } from './sdk-patch-fixture.js';

it('published SDK cancels late discovery and pending hello without any post-stop socket or retry timers', async () => {
  const fixture = await loadPublishedKookFixture();
  const clients = [];
  try {
    let resolveDiscovery!: (value: unknown) => void;
    const pending = new Promise(resolve => { resolveDiscovery = resolve; });
    const socketFactory = vi.fn();
    const client = new fixture.sdk.Client({ token: 'fixture', handleProcessErrors: false, mode: 'websocket', autoReconnect: false, socketFactory, logLevel: 'off' });
    clients.push(client); client.request.get = vi.fn(() => pending); client.init = vi.fn(async () => {});
    const connect = client.connect(); const rejected = expect(connect).rejects.toThrow('cancelled');
    await client.disconnect(); resolveDiscovery({ data: { url: 'wss://gateway.test/?ticket=fixture' } });
    await rejected;
    expect(socketFactory).not.toHaveBeenCalled();
    expect(client.receiver.timers.size).toBe(0);
    expect(client.receiver.reconnectTimer).toBeNull();
    expect(client.receiver.config.autoReconnect).toBe(false);
    const socket = Object.assign(new EventEmitter(), { readyState: 0, terminate: vi.fn(), send: vi.fn() });
    const second = new fixture.sdk.Client({ token: 'fixture', handleProcessErrors: false, mode: 'websocket', autoReconnect: false, socketFactory: () => socket, logLevel: 'off' }); clients.push(second);
    second.request.get = vi.fn(async () => ({ data: { url: 'wss://gateway.test/?ticket=fixture' } })); second.init = vi.fn(async () => {});
    const hello = second.connect(); const helloRejected = expect(hello).rejects.toThrow('cancelled');
    for (let i = 0; i < 5; i++) await Promise.resolve();
    await second.disconnect(); await helloRejected;
    expect(socket.terminate).toHaveBeenCalled();
    expect(second.receiver.cancelHello).toBeNull();
    expect(second.receiver.timers.size).toBe(0);
  } finally { await Promise.all(clients.map(client => client.disconnect())); fixture.close(); }
});

it('SDK process-error hook remains opt-in by default and false leaves existing handlers untouched', async () => {
  const fixture = await loadPublishedKookFixture();
  const on = vi.spyOn(process, 'on').mockReturnValue(process);
  const off = vi.spyOn(process, 'off');
  try {
    const optedOut = new fixture.sdk.Client({ token: 'fixture', mode: 'websocket', autoReconnect: false, handleProcessErrors: false, logLevel: 'off' });
    expect(on.mock.calls.filter(([event]) => event === 'uncaughtException')).toHaveLength(0);
    expect(off).not.toHaveBeenCalled();
    const standard = new fixture.sdk.Client({ token: 'fixture', mode: 'websocket', autoReconnect: false, logLevel: 'off' });
    expect(on.mock.calls.filter(([event]) => event === 'uncaughtException')).toHaveLength(1);
    await optedOut.disconnect(); await standard.disconnect();
    expect(off).not.toHaveBeenCalled();
  } finally { on.mockRestore(); off.mockRestore(); fixture.close(); }
});
