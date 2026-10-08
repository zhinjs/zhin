import * as sdk from '@larksuiteoapi/node-sdk';
import { createLarkLongConnection } from '../src/long-connection.js';
import { resolveLarkConfig } from '../src/protocol.js';

describe('published Lark SDK long connection contract', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
  it('waits for onReady rather than start return and maps real EventDispatcher events', async () => {
    vi.useFakeTimers();
    let client!: sdk.WSClient;
    let dispatcher!: sdk.EventDispatcher;
    vi.spyOn(sdk.WSClient.prototype, 'start').mockImplementation(async function (this: sdk.WSClient, options) {
      // eslint-disable-next-line @typescript-eslint/no-this-alias -- Inspect the actual constructed SDK instance.
      client = this; dispatcher = options.eventDispatcher;
    });
    vi.spyOn(sdk.WSClient.prototype, 'getConnectionStatus').mockReturnValue({ state: 'connected', reconnectAttempts: 0 });
    const receive = vi.fn(); const cardAction = vi.fn(); const disconnected = vi.fn();
    const transport = createLarkLongConnection({
      config: resolveLarkConfig({ id: 'bot', appId: 'cli_0123456789abcdef', appSecret: 'fixture-secret', mode: 'websocket' }),
      receive, cardAction, disconnected,
    });
    let settled = false;
    const connection = transport.connect().then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    // Published SDK stores callback on the constructed instance; exercising it
    // proves our bridge uses the readiness callback instead of start settlement.
    (client as unknown as { onReady(): void }).onReady();
    await connection;
    await dispatcher.invoke({ schema: '2.0', header: { event_type: 'im.message.receive_v1', event_id: 'event1' }, event: { message: { message_id: 'om1', chat_id: 'oc1', chat_type: 'p2p', message_type: 'text', content: '{"text":"hello"}' }, sender: { sender_id: { open_id: 'ou1' } } } }, { needCheck: false });
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({ message_id: 'om1', sender: { sender_id: { open_id: 'ou1' } } }));
    const action = { context: { open_message_id: 'om1', open_chat_id: 'oc1' }, operator: { open_id: 'ou1' }, action: { tag: 'button', value: { zhin_payload: 'confirm' } } };
    await dispatcher.invoke({ schema: '2.0', header: { event_type: 'card.action.trigger', event_id: 'click1' }, event: action }, { needCheck: false });
    expect(cardAction).toHaveBeenCalledWith(expect.objectContaining(action));
    vi.mocked(client.getConnectionStatus).mockReturnValue({ state: 'idle', reconnectAttempts: 0 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(disconnected).toHaveBeenCalledTimes(1);
    transport.close();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('closes during handshake and ignores late SDK readiness', async () => {
    vi.useFakeTimers();
    let ready!: () => void;
    vi.spyOn(sdk.WSClient.prototype, 'start').mockImplementation(async function (this: sdk.WSClient) {
      ready = () => (this as unknown as { onReady(): void }).onReady();
    });
    const transport = createLarkLongConnection({ config: resolveLarkConfig({ id: 'bot', appId: 'cli_0123456789abcdef', appSecret: 'fixture-secret', mode: 'websocket' }), receive: vi.fn(), disconnected: vi.fn() });
    const connection = transport.connect();
    const rejected = expect(connection).rejects.toThrow('stopped');
    await Promise.resolve();
    transport.close(); ready();
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });
  it('times out an SDK start that silently returns without handshake and cleans timers', async () => {
    vi.useFakeTimers();
    vi.spyOn(sdk.WSClient.prototype, 'start').mockResolvedValue(undefined);
    const transport = createLarkLongConnection({ config: resolveLarkConfig({ id: 'bot', appId: 'cli_0123456789abcdef', appSecret: 'fixture-secret', mode: 'websocket' }), receive: vi.fn(), disconnected: vi.fn() });
    const connection = transport.connect();
    const rejected = expect(connection).rejects.toThrow('handshake timed out');
    await vi.advanceTimersByTimeAsync(30_000);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });
});
