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

async function createHarness(onPlatform: (signal: AbortSignal) => Promise<void>) {
  const owner = rootPluginId();
  const empty: SnapshotState = { root: owner, tree: new Map(), config: new Map(), resources: new Map(), capabilities: new Map(), projections: new Map() };
  const root = new RootController(empty), im = new ImRuntime(); im.attach(root.snapshots);
  const disposed: number[] = [], clients: NativeEndpoint[] = [], adapters: Adapter<NativeEndpoint>[] = [];
  const messages: Array<{ version: number; client: unknown }> = [];
  class NativeEndpoint extends EventEmitter implements Endpoint {
    readonly [endpointSpec] = createEndpointSpecification(this, { start() {}, open() {}, close() {}, stop() {} });
  }
  async function prepare(version: number) {
    const adapter = createCapabilitySlot({ owner, feature: adapterFeatureId, localName: 'native', source: '/fixture/adapters/native/index.ts',
      definition: defineAdapter({ capabilities: ['inbound'], createAdapter: () => {
        const instance = new class extends Adapter<NativeEndpoint> {
          protected createEndpoint() { const client = new NativeEndpoint(); clients.push(client); return client; }
        }();
        adapters.push(instance); return instance;
      } }) });
    const handlers = [
      createCapabilitySlot({ owner, feature: handlerFeatureId, localName: 'native/platform', source: '/fixture/handlers/platform/index.ts',
        definition: defineHandler({ event: 'platform.receive', handle() { return onPlatform(this.signal); } }) }),
      createCapabilitySlot({ owner, feature: handlerFeatureId, localName: 'native/message', source: '/fixture/handlers/message/index.ts',
        definition: defineHandler({ event: 'message.receive', handle(input) { messages.push({ version, client: input.client }); } }) }),
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
      dispose: async () => { disposed.push(version); await index.stop(); },
      handoff: { activateNext: (signal: AbortSignal) => index.activate(signal), deactivateNext: () => index.stop() } };
  }
  await root.start(() => prepare(1));
  return { root, clients, adapters, disposed, messages, replace: () => root.transact(() => prepare(2)) };
}

it.each(['replace', 'account stop', 'Root stop'] as const)('owns an unawaited child Handler until completion across %s', async action => {
  const pause = deferred(), entered = deferred(), late = deferred();
  let signal!: AbortSignal;
  const h = await createHarness(async current => { signal = current; entered.resolve(); await pause.promise; });
  const original = h.clients[0]!, events = original[endpointSpec].events;
  let child!: Promise<unknown>, escaped!: Promise<unknown>, closing: Promise<unknown> | undefined;
  const receipt = events.run(() => {
    child = events.platform('native.ready', {});
    escaped = late.promise.then(() => events.run(() => events.platform('escaped', {})));
    void escaped.catch(() => undefined);
    return 'parent result';
  });
  try {
    await entered.promise;
    // The parent callback has settled while its accepted child Handler is pending.
    await new Promise<void>(resolve => setImmediate(resolve));
    if (action === 'replace') await h.replace();
    else if (action === 'Root stop') closing = h.root.stop();
    else {
      const adapter = h.adapters[0]!, account = adapter.list()[0]!;
      closing = adapter.stop(account.instanceId, adapter.revision);
    }
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(signal.aborted).toBe(action !== 'replace');
    if (action === 'replace') {
      expect(h.disposed).not.toContain(1);
      late.resolve();
      await expect(escaped).rejects.toThrow('retired');
    }
    pause.resolve(); await child;
    await expect(receipt).resolves.toBe('parent result');
    await closing;
    if (action === 'replace') await vi.waitFor(() => expect(h.disposed).toContain(1));
  } finally { late.resolve(); pause.resolve(); await Promise.allSettled([receipt, child, escaped]); await closing; await h.root.stop(); }
});

it.each(['return', 'throw'] as const)('drains a detached normalizer and preserves the parent callback %s', async outcome => {
  const pause = deferred(), entered = deferred();
  const h = await createHarness(async () => undefined);
  const original = h.clients[0]!, events = original[endpointSpec].events;
  let child!: Promise<unknown>;
  const failure = new Error('parent failure');
  const receipt = events.run(() => {
    child = events.run(async () => {
      entered.resolve(); await pause.promise;
      await events.message({ conversation: { kind: 'group', id: 'room' }, content: 'normalized', sender: { id: 'alice' } });
    });
    if (outcome === 'throw') throw failure;
    return 'parent result';
  });
  void receipt.catch(() => undefined);
  try {
    await entered.promise;
    await new Promise<void>(resolve => setImmediate(resolve));
    await h.replace();
    expect(h.disposed).not.toContain(1);
    pause.resolve(); await child;
    if (outcome === 'throw') await expect(receipt).rejects.toBe(failure);
    else await expect(receipt).resolves.toBe('parent result');
    expect(h.messages).toEqual([{ version: 1, client: original }]);
    await vi.waitFor(() => expect(h.disposed).toContain(1));
  } finally { pause.resolve(); await Promise.allSettled([receipt, child]); await h.root.stop(); }
});

it('leaves a detached child failure with its caller while preserving the parent result', async () => {
  const pause = deferred(), entered = deferred();
  const h = await createHarness(async () => undefined);
  const events = h.clients[0]![endpointSpec].events;
  const failure = new Error('child failure');
  let child!: Promise<unknown>;
  const receipt = events.run(() => {
    child = events.run(async () => { entered.resolve(); await pause.promise; throw failure; });
    void child.catch(() => undefined);
    return 'parent result';
  });
  try {
    await entered.promise;
    await h.replace();
    expect(h.disposed).not.toContain(1);
    pause.resolve();
    await expect(child).rejects.toBe(failure);
    await expect(receipt).resolves.toBe('parent result');
    await vi.waitFor(() => expect(h.disposed).toContain(1));
  } finally { pause.resolve(); await Promise.allSettled([receipt, child]); await h.root.stop(); }
});
