import WebSocket, { WebSocketServer } from 'ws';
import { AdapterIndex, adapterFeatureId, endpointEventGatewayToken } from 'zhin.js/adapter';
import { SnapshotStore, createCapabilitySlot, createSnapshotView, rootPluginId, type SnapshotState, type TokenId } from 'zhin.js/plugin-runtime';
import { ImRuntime } from '@zhin.js/core/runtime';
import definition from '../adapters/onebot12/index.js';

it('Core captured operations propagate cancellation through unified rendering and the actual native RPC', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  const actions: Array<{ action: string; echo: string }> = []; let peer: WebSocket | undefined;
  server.on('connection', socket => { peer = socket; socket.on('message', raw => actions.push(JSON.parse(String(raw)))); });
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Local platform did not listen');
  const root = rootPluginId(), im = new ImRuntime();
  const slot = createCapabilitySlot({ owner: root, feature: adapterFeatureId, localName: 'onebot12', source: '/fixture/adapters/onebot12/index.ts', definition });
  const state: SnapshotState = { root,
    tree: new Map([[root, { id: root, instanceKey: 'root', packageName: 'fixture', packageRoot: '/fixture', children: [] }]]),
    config: new Map([[root, { id: 'synthetic', platform: 'qq', userId: 'bot', url: `ws://127.0.0.1:${address.port}`, heartbeat_interval: 60_000 }]]),
    capabilities: new Map([[slot.id, slot]]), projections: new Map(),
    resources: new Map([[root, new Map<TokenId, unknown>([[endpointEventGatewayToken.id, im.endpointEvents]])]]),
  };
  const index = await AdapterIndex.create([slot], createSnapshotView(0, state), new AbortController().signal);
  const store = new SnapshotStore({ ...state, projections: new Map([[adapterFeatureId, index]]) }); im.attach(store);
  await index.activate(new AbortController().signal);
  const id = index.describe()[0]!.id, source = new AbortController();
  const target = { endpoint: { id, adapter: 'onebot12' }, kind: 'private' as const, id: 'user' };
  const operation = im.endpoints.captureOperation({ target, client: index.clientById(id), signal: source.signal });
  const sending = operation.send([{ type: 'image', data: { media: { kind: 'base64', mime_type: 'image/png', value: 'c3ludGhldGlj' } } }]);
  try {
    await vi.waitFor(() => expect(actions.map(action => action.action)).toEqual(['upload_file']));
    source.abort();
    await expect(sending).resolves.toMatchObject({ status: 'failed', failure: { deliveryUnknown: true } });
    peer!.send(JSON.stringify({ status: 'ok', retcode: 0, echo: actions[0]!.echo, data: { file_id: 'late-upload' } }));
    await expect(operation.send('late')).rejects.toMatchObject({ disposition: 'not_sent' });
    expect(actions.map(action => action.action)).toEqual(['upload_file']);
  } finally {
    operation.release(); peer?.terminate(); await sending; await index.stop(); await store.close();
    for (const socket of server.clients) socket.terminate(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
