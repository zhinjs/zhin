import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { SnapshotStore, createCapabilitySlot, createSnapshotView, rootPluginId, type SnapshotState } from '@zhin.js/plugin-runtime';
import { Adapter, AdapterIndex, adapterFeatureId, createEndpointSpecification, defineAdapter, endpointSpec, endpointEventGatewayToken, type Endpoint } from '../src/index.js';
import { getProcessPeerRegistry } from '../src/peer-registry.js';

class NativeClient extends EventEmitter { readonly nativeMethod = () => 'native'; }
class ReportingEndpoint extends NativeClient implements Endpoint {
  readonly [endpointSpec] = createEndpointSpecification(this, { start() {}, open() {}, close() {}, stop() {} });
  report(value: unknown): void { Reflect.apply(this[endpointSpec].reportSelfUserId, this[endpointSpec], [value]); }
}
class ReportingAdapter extends Adapter<ReportingEndpoint> {
  constructor(readonly endpoint: ReportingEndpoint) { super(); }
  protected createEndpoint(): ReportingEndpoint { return this.endpoint; }
}
const registry = getProcessPeerRegistry(), cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function fixture(endpoint = new ReportingEndpoint(), owner = rootPluginId()) {
  const slot = createCapabilitySlot({ owner, feature: adapterFeatureId, localName: 'fake', source: '/fixture/adapters/fake/index.ts',
    definition: defineAdapter({ capabilities: ['inbound'], createAdapter: () => new ReportingAdapter(endpoint) }) });
  const state: SnapshotState = { root: owner, tree: new Map([[owner, { id: owner, instanceKey: 'root', packageName: 'fixture', packageRoot: '/fixture', children: [] }]]),
    config: new Map([[owner, {}]]), resources: new Map([[owner, new Map([[endpointEventGatewayToken.id, { async run<T>(this: import('@zhin.js/adapter').EndpointEventGateway, receive: (receipt: import('@zhin.js/adapter').EndpointReceipt) => T | Promise<T>) { return receive(this); }, receive: async () => undefined }]])]]), capabilities: new Map([[slot.id, slot]]), projections: new Map() };
  const index = await AdapterIndex.create([slot], createSnapshotView(0, state), new AbortController().signal);
  await index.start();
  const prepared = { ...state, projections: new Map([[adapterFeatureId, index]]) };
  cleanup.push(() => index.stop());
  const publish = () => { const store = new SnapshotStore(prepared); cleanup.push(() => store.close()); return store; };
  return { endpoint, owner, index, id: slot.id, state: prepared, publish };
}

describe('native Endpoint self reporting through the owning Index and real generation admission', () => {
  it('registers immediately in an active published generation and unregisters on retirement', async () => {
    const f = await fixture(); const store = f.publish();
    expect(registry.selfOf(f.id)).toBeUndefined(); f.endpoint.report(12345);
    expect(registry.selfOf(f.id)).toBe('12345'); expect(registry.lookup('fake', '12345')?.endpointIds).toEqual([f.id]);
    expect(f.endpoint.nativeMethod()).toBe('native'); expect(f.index.client('fake', f.id)).toBe(f.endpoint);
    await store.close(); expect(registry.isReady(f.id)).toBe(false);
  });
  it('stays out while pending, registers on real snapshot activation, and removes on deactivation', async () => {
    const f = await fixture(); f.endpoint.report('777'); expect(registry.isReady(f.id)).toBe(false);
    const store = f.publish(); expect(registry.selfOf(f.id)).toBe('777');
    await store.close(); expect(registry.isReady(f.id)).toBe(false);
  });
  it('never registers a disposed candidate even if its stale projection is published later', async () => {
    const f = await fixture(); f.endpoint.report('777'); await f.index.stop();
    f.publish(); expect(registry.isReady(f.id)).toBe(false);
  });
  it('retains a report made before binding and only publishes it once admitted', async () => {
    const endpoint = new ReportingEndpoint(); endpoint.report('55'); const f = await fixture(endpoint);
    expect(registry.isReady(f.id)).toBe(false); f.publish(); expect(registry.selfOf(f.id)).toBe('55');
  });
  it('fails closed on invalid runtime values and revokes on undefined', async () => {
    const f = await fixture(); f.publish();
    for (const bad of ['', '  ', undefined, null, NaN, {}]) { f.endpoint.report(bad); expect(registry.isReady(f.id)).toBe(false); }
    f.endpoint.report('9'); expect(registry.isReady(f.id)).toBe(true); f.endpoint.report(undefined); expect(registry.isReady(f.id)).toBe(false);
  });
  it('updates the platform login id in place without changing the canonical identity', async () => {
    const f = await fixture(); f.publish(); const identity = f.endpoint[endpointSpec].identity;
    f.endpoint.report('1'); f.endpoint.report('2'); expect(registry.selfOf(f.id)).toBe('2');
    expect(registry.lookup('fake', '1')).toBeUndefined(); expect(f.endpoint[endpointSpec].identity).toBe(identity);
  });
  it('does not let old cleanup delete the next generation login', async () => {
    const previous = await fixture(), store = previous.publish(); previous.endpoint.report('1');
    const next = await fixture(new ReportingEndpoint(), previous.owner); next.endpoint.report('2');
    store.commit(0, { snapshot: next.state, dispose: () => next.index.stop() });
    expect(registry.selfOf(next.id)).toBe('2'); await previous.index.stop(); expect(registry.selfOf(next.id)).toBe('2');
    await store.close(); expect(registry.isReady(next.id)).toBe(false);
  });
  it('ignores stale native login events after a new generation is active', async () => {
    const previous = await fixture(), store = previous.publish(); previous.endpoint.report('1');
    const next = await fixture(new ReportingEndpoint(), previous.owner); store.commit(0, { snapshot: next.state, dispose: () => next.index.stop() });
    next.endpoint.report('2'); previous.endpoint.report('1'); expect(registry.selfOf(next.id)).toBe('2');
  });
  it('keeps the symbol-namespaced canonical identity frozen and unchanged', async () => {
    const f = await fixture(); f.publish(); f.endpoint.report('1');
    expect(Object.isFrozen(f.endpoint[endpointSpec].identity)).toBe(true);
    expect(Object.keys(f.endpoint[endpointSpec].identity).sort()).toEqual(['adapter', 'id']);
    expect('selfUserId' in f.endpoint).toBe(false);
  });
  it('reports native login completion explicitly through endpointSpec, without the removed compact activation/getter protocol', async () => {
    class LoginEndpoint extends ReportingEndpoint {
      readonly login = () => { this[endpointSpec].reportSelfUserId('4242'); };
      get selfUserId(): string { throw new Error('native getter is not a framework hook'); }
    }
    const endpoint = new LoginEndpoint(), f = await fixture(endpoint); f.publish(); endpoint.login();
    expect(registry.selfOf(f.id)).toBe('4242'); await f.index.stop(); expect(registry.isReady(f.id)).toBe(false);
  });
  it('reserves the new generation before its login arrives, so an earlier native re-report cannot regain ownership', async () => {
    const previous = await fixture(), store = previous.publish(); const next = await fixture(new ReportingEndpoint(), previous.owner);
    store.commit(0, { snapshot: next.state, dispose: () => next.index.stop() });
    next.endpoint.report('2'); previous.endpoint.report('1'); expect(registry.selfOf(next.id)).toBe('2');
  });
});
