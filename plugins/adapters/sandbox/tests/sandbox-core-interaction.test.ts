import WebSocket from 'ws';
import { AdapterIndex, adapterFeatureId, endpointEventGatewayToken, type EndpointEvent, type EndpointEventGateway } from '@zhin.js/adapter';
import { createCapabilitySlot, createSnapshotView, SnapshotStore, rootPluginId, projectLocaleToken, readOperationSession, type OperationSession, type SnapshotState } from 'zhin.js';
import { ImRuntime, RuntimeMessage, type Message } from '@zhin.js/core/runtime';
import { createHttpHost, httpHostToken } from '@zhin.js/host-http';
import sandboxAdapter from '../adapters/sandbox/index.js';
import { SandboxClient } from '../src/client.js';

it('settles the original Core confirm once through the real Sandbox wire, never admitting its callback as ordinary chat', async () => {
  const root = rootPluginId(), abort = new AbortController();
  const ordinary = vi.fn();
  const sessions: OperationSession[] = [];
  const im = new ImRuntime({ inboundClaim(message: Message) {
    // The normal chat consumer leaves explicit platform actions to Core's interaction authority.
    if (message.segments?.some(segment => segment.type === 'action')) return false;
    const session = readOperationSession(message); if (!session) throw new Error('Sandbox Core Session is missing'); sessions.push(session);
    ordinary(message.content); return true;
  } });
  const http = createHttpHost({ host: '127.0.0.1', port: 0, token: 'local-full' });
  const adapter = createCapabilitySlot({ owner: root, feature: adapterFeatureId, localName: 'sandbox',
    source: '/project/adapters/sandbox/index.ts', definition: sandboxAdapter });
  let processed = 0;
  const receive = async (event: EndpointEvent, dispatch: EndpointEventGateway['receive']) => {
    try { return await dispatch(event); }
    finally { if (event.name === 'message.receive') processed++; }
  };
  const gateway: EndpointEventGateway = {
    run: execute => im.endpointEvents.run(receipt => execute({ receive: event => receive(event, receipt.receive) })),
    receive: event => receive(event, im.endpointEvents.receive),
  };
  const state: SnapshotState = {
    root, tree: new Map([[root, { id: root, instanceKey: 'root', packageName: 'test', packageRoot: '/project', children: [] }]]),
    config: new Map([[root, { id: 'interaction-bot', owner: 'configured-owner' }]]),
    resources: new Map([[root, new Map([[httpHostToken.id, http], [endpointEventGatewayToken.id, gateway], [projectLocaleToken.id, 'en']])]]),
    capabilities: new Map([[adapter.id, adapter]]), projections: new Map(),
  };
  const view = createSnapshotView(0, state);
  const adapters = await AdapterIndex.create([adapter], view, abort.signal);
  const snapshots = new SnapshotStore({ ...state, projections: new Map([[adapterFeatureId, adapters]]) });
  im.attach(snapshots);
  const clients: WebSocket[] = [];
  let answer: Promise<boolean> | undefined;
  try {
    await adapters.start(); adapters.open();
    const { port } = await http.listen();
    const connect = async () => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/sandbox?token=local-full`);
      clients.push(socket);
      const frames: Record<string, any>[] = [];
      socket.on('message', raw => frames.push(JSON.parse(String(raw))));
      await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
      await vi.waitFor(() => expect(frames.some(frame => frame.type === 'ready')).toBe(true));
      socket.send(JSON.stringify({ op: 'subscribe', conversation: { type: 'group', id: 'room' } }));
      await vi.waitFor(() => expect(frames.some(frame => frame.type === 'subscribed')).toBe(true));
      return { socket, frames };
    };
    const first = await connect(), second = await connect();
    const frame = JSON.stringify({ type: 'group', id: 'room', messageId: 'normal-input', content: 'normal chat', timestamp: 1 });
    first.socket.send(frame);
    await vi.waitFor(() => expect(processed).toBe(1));
    expect(ordinary).toHaveBeenCalledExactlyOnceWith('normal chat'); ordinary.mockClear();
    const native = adapters.client<SandboxClient>('sandbox', String(adapter.id));
    expect(native).toBeInstanceOf(SandboxClient);
    expect(sessions[0]?.endpoint).toBe(native); expect(sessions[0]?.adapter).toBe(adapters.adapter(adapter.id));
    expect(sessions[0]?.event).toBe(frame); expect(sessions[0]?.sender?.id).toBe('configured-owner');
    expect(sessions[0]?.message).toMatchObject({ id: 'normal-input', text: 'normal chat' });
    expect(sessions[0]?.scene).toMatchObject({ kind: 'group', id: 'room', endpoint: { adapter: 'sandbox', id: adapter.id } });
    const conversation = { endpoint: { adapter: 'sandbox', id: String(adapter.id) }, kind: 'group' as const, id: 'room' };
    let settlements = 0;
    answer = im.createInteraction(new RuntimeMessage(
      { conversation: conversation, content: 'ask', sender: { id: 'configured-owner' } },
      { generation: 0, reply: (content) => im.send({ requester: root, conversation, content }) },
    ))!
      .ask({ type: 'confirm', title: 'Allow this operation?', signal: abort.signal });
    void answer.then(() => { settlements++; }, () => undefined);
    await vi.waitFor(() => expect(first.frames.some(frame => frame.content?.some((segment: any) => segment.type === 'keyboard'))).toBe(true));
    const prompt = first.frames.find(frame => frame.content?.some((segment: any) => segment.type === 'keyboard'))!;
    const keyboard = prompt.content.find((segment: any) => segment.type === 'keyboard');
    const payload = keyboard.data.rows[0][0].payload as string;
    expect(payload).toMatch(/^zhin:ask:/u);
    const click = (socket: WebSocket, id: string) => socket.send(JSON.stringify({ type: 'group', id: 'room', messageId: id,
      content: [{ type: 'action', data: { id: payload, payload } }], timestamp: Date.now() }));
    click(first.socket, 'callback-1');
    await vi.waitFor(() => expect(processed).toBe(2));
    expect(ordinary).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(settlements).toBe(1));
    await expect(answer).resolves.toBe(true);
    expect(settlements).toBe(1);
    click(second.socket, 'callback-duplicate');
    await vi.waitFor(() => expect(processed).toBe(3));
    expect(ordinary).not.toHaveBeenCalled(); expect(settlements).toBe(1);
    expect(im.readPendingInteraction(conversation, 'configured-owner', 0)).toBeUndefined();
  } finally {
    abort.abort(); await answer?.catch(() => undefined);
    for (const socket of clients) socket.terminate();
    await adapters.stop(); await snapshots.close(); await http.close();
  }
});
