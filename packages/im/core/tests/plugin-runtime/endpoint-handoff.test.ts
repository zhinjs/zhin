import { EventEmitter } from 'node:events';
import { RootController, createCapabilitySlot, createSnapshotView, rootPluginId,
  type SnapshotState, type FeatureId, type TokenId } from '@zhin.js/plugin-runtime';
import { Adapter, AdapterIndex, adapterFeatureId, defineAdapter, createEndpointSpecification,
  endpointEventGatewayToken, endpointSpec, type Endpoint } from '@zhin.js/adapter';
import { HandlerIndex, defineHandler, handlerFeatureId } from '@zhin.js/handler';
import { ImRuntime } from '../../src/plugin-runtime/im/index.js';
import { MemoryDesiredRepository } from '../../../../../plugins/adapters/test-utils/desired-repository.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

/** A real ImRuntime whose `message.receive` Handler stands in for an Agent turn waiting on the next inbound. */
async function createHarness(onMessage: (call: number) => Promise<void>) {
  let calls = 0;
  const owner = rootPluginId();
  const empty: SnapshotState = { root: owner, tree: new Map(), config: new Map(), resources: new Map(), capabilities: new Map(), projections: new Map() };
  const root = new RootController(empty), im = new ImRuntime(); im.attach(root.snapshots);
  const clients: NativeEndpoint[] = [];
  class NativeEndpoint extends EventEmitter implements Endpoint {
    readonly [endpointSpec] = createEndpointSpecification(this, { start() {}, open() {}, close() {}, stop() {} });
  }
  async function prepare(version: number) {
    const adapter = createCapabilitySlot({ owner, feature: adapterFeatureId, localName: 'native', source: '/fixture/adapters/native/index.ts',
      definition: defineAdapter({ capabilities: ['inbound'], createAdapter: () => new class extends Adapter<NativeEndpoint> {
        protected createEndpoint() { const client = new NativeEndpoint(); clients.push(client); return client; }
      }() }) });
    const handlers = [
      createCapabilitySlot({ owner, feature: handlerFeatureId, localName: 'native/message', source: '/fixture/handlers/message/index.ts',
        definition: defineHandler({ event: 'message.receive', handle() { calls += 1; return onMessage(calls); } }) }),
    ];
    const state: SnapshotState = { ...empty,
      tree: new Map([[owner, { id: owner, instanceKey: 'root', packageName: 'fixture', packageRoot: '/fixture', children: [] }]]),
      config: new Map([[owner, {}]]),
      resources: new Map([[owner, new Map<TokenId, unknown>([[endpointEventGatewayToken.id, im.endpointEvents]])]]),
      capabilities: new Map([adapter, ...handlers].map(slot => [slot.id, slot])),
    };
    const repository = new MemoryDesiredRepository(); repository.snapshot = undefined;
    const snapshot = createSnapshotView(version, state), index = await AdapterIndex.create([adapter], snapshot, new AbortController().signal, { repository });
    return { snapshot: { ...state, projections: new Map<FeatureId, unknown>([[adapterFeatureId, index], [handlerFeatureId, new HandlerIndex(handlers, snapshot)]]) },
      dispose: async () => { await index.stop(); },
      handoff: { activateNext: (signal: AbortSignal) => index.activate(signal), deactivateNext: () => index.stop() } };
  }
  await root.start(() => prepare(1));
  return { root, clients };
}

const inbound = (id: string, content: string) => ({
  conversation: { kind: 'private' as const, id: 'u1' }, message: { id } as never,
  content, sender: { id: 'u1', name: 'User' },
});

// #1250 adapter-inbound-deadlock: the Runtime accepts a handed-off message before its dispatch, so a
// polling Endpoint can fetch the answer its Agent turn is waiting for.
it('settles admit + handoffMessage once the Runtime accepted the message, while its dispatch still runs', async () => {
  const answer = deferred(), started = deferred();
  const seen: number[] = [];
  const h = await createHarness(async (call) => {
    seen.push(call);
    if (call === 1) { started.resolve(); await answer.promise; }
  });
  const events = h.clients[0]![endpointSpec].events;
  try {
    let dispatchedFirst = false;
    const first = await events.admit(() => events.handoffMessage(inbound('m1', 'first')));
    void first.dispatched.then(() => { dispatchedFirst = true; });
    await started.promise;
    expect(dispatchedFirst).toBe(false);
    // The next inbound is taken while the first dispatch still waits for it.
    const second = await events.admit(() => events.handoffMessage(inbound('m2', 'second')));
    await second.dispatched;
    expect(seen).toEqual([1, 2]);
    expect(dispatchedFirst).toBe(false);
    answer.resolve();
    await first.dispatched;
    expect(dispatchedFirst).toBe(true);
  } finally {
    answer.resolve();
    await h.root.stop();
  }
});

it('keeps run settling only after the dispatch it emitted', async () => {
  const answer = deferred(), started = deferred();
  const h = await createHarness(async () => { started.resolve(); await answer.promise; });
  const events = h.clients[0]![endpointSpec].events;
  try {
    let settled = false;
    const running = events.run(() => { void events.message(inbound('m1', 'first')); }).then(() => { settled = true; });
    await started.promise;
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(settled).toBe(false);
    answer.resolve();
    await running;
    expect(settled).toBe(true);
  } finally {
    answer.resolve();
    await h.root.stop();
  }
});
