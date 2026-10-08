import { capabilityId, rootPluginId } from 'zhin.js';
import { LarkEndpoint } from '../src/endpoint.js';
import { resolveLarkConfig } from '../src/protocol.js';
import type { LarkLongConnectionOptions } from '../src/long-connection.js';

describe('Lark long connection lifecycle', () => {
  afterEach(() => vi.useRealTimers());
  function setup(connect = vi.fn(async () => {})) {
    const sessions: Array<{ options: LarkLongConnectionOptions; close: ReturnType<typeof vi.fn> }> = [];
    const endpoint = new LarkEndpoint({
      id: capabilityId(rootPluginId('test'), 'adapter', 'lark'),
      config: resolveLarkConfig({ id: 'bot', appId: 'cli', appSecret: 'secret', mode: 'websocket' }),
      fetch: vi.fn(() => { throw new Error('HTTP must not be required'); }),
      longConnectionFactory: (options) => {
        const close = vi.fn(); sessions.push({ options, close });
        return { connect, close };
      },
    });
    return { endpoint, sessions, connect };
  }
  it('observes handshake, gates admission, and deduplicates message ids', async () => {
    const { endpoint, sessions } = setup();
    const emit = vi.spyOn(endpoint, 'emit').mockResolvedValue(undefined);
    await endpoint.start();
    expect(endpoint.transportState).toBe('open');
    const message = { message_id: 'om1', chat_id: 'oc1', chat_type: 'p2p', message_type: 'text', content: '{"text":"hello"}' };
    sessions[0]!.options.receive(message);
    expect(emit).not.toHaveBeenCalled();
    endpoint.open();
    sessions[0]!.options.receive(message); sessions[0]!.options.receive(message);
    expect(emit).toHaveBeenCalledTimes(1);
    await endpoint.stop();
    sessions[0]!.options.receive({ ...message, message_id: 'om2' });
    expect(emit).toHaveBeenCalledTimes(1);
    expect(endpoint.transportState).toBe('stopped');
    expect(sessions[0]!.close).toHaveBeenCalledTimes(1);
  });
  it('cancels an in-progress connect and ignores late settlement', async () => {
    let finish!: () => void;
    const { endpoint, sessions } = setup(vi.fn(() => new Promise<void>((resolve) => { finish = resolve; })));
    const start = endpoint.start();
    await Promise.resolve();
    await endpoint.stop();
    await start;
    finish(); await Promise.resolve();
    expect(endpoint.transportState).toBe('stopped');
    expect(sessions[0]!.close).toHaveBeenCalledTimes(1);
  });
  it('reports initial failure without claiming readiness', async () => {
    const { endpoint } = setup(vi.fn(async () => { throw new Error('handshake rejected'); }));
    await expect(endpoint.start()).rejects.toThrow('handshake rejected');
    expect(endpoint.transportState).toBe('stopped');
  });
  it('reconnects through the shared lifecycle and suppresses old receive callbacks', async () => {
    vi.useFakeTimers();
    const { endpoint, sessions } = setup();
    const emit = vi.spyOn(endpoint, 'emit').mockResolvedValue(undefined);
    await endpoint.start(); endpoint.open();
    sessions[0]!.options.disconnected();
    expect(endpoint.transportState).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(5_500);
    expect(endpoint.transportState).toBe('open');
    expect(sessions).toHaveLength(2);
    sessions[0]!.options.receive({ message_id: 'old' });
    expect(emit).not.toHaveBeenCalled();
    await endpoint.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sessions).toHaveLength(2);
    expect(emit).not.toHaveBeenCalled();
  });
  it('validates mode and keeps HTTP as the default', () => {
    expect(resolveLarkConfig({ id: 'b', appId: 'a', appSecret: 's' }).mode).toBe('webhook');
    expect(() => resolveLarkConfig({ id: 'b', appId: 'a', appSecret: 's', mode: 'bad' as never })).toThrow('Lark mode');
  });
});
