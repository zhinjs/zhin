import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SnapshotStore, createCapabilitySlot, createSnapshotView, rootPluginId, type SnapshotState } from '@zhin.js/plugin-runtime';
import { readOperationClient } from '@zhin.js/feature-kit';
import { Adapter, AdapterIndex, adapterFeatureId, createEndpointSpecification, defineAdapter, endpointSpec, endpointEventGatewayToken,
  forwardEndpointClientEvents, type Endpoint, type EndpointEvent } from '../src/index.js';

class NativeClient extends EventEmitter { call(action: string): string { return action; } }
class NativeEventEndpoint extends NativeClient implements Endpoint {
  #release?: () => void;
  readonly [endpointSpec] = createEndpointSpecification(this, {
    start() {},
    open: () => { this.#release = forwardEndpointClientEvents(this, ['native.event'], (name, event) => { void this[endpointSpec].events.platform(name, event); }); },
    close: () => { this.#release?.(); this.#release = undefined; },
    stop: () => { this.#release?.(); this.#release = undefined; },
  });
}
class NativeAdapter extends Adapter<NativeEventEndpoint> {
  protected createEndpoint(): NativeEventEndpoint { return new NativeEventEndpoint(); }
}
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function fixture() {
  const owner = rootPluginId(), receive = vi.fn(async (_event: EndpointEvent) => undefined);
  const adapter = new NativeAdapter();
  const slot = createCapabilitySlot({ owner, feature: adapterFeatureId, localName: 'native', source: '/fixture/adapters/native/index.ts',
    definition: defineAdapter({ capabilities: ['inbound'], createAdapter: () => adapter }) });
  const state: SnapshotState = { root: owner, tree: new Map([[owner, { id: owner, instanceKey: 'root', packageName: 'fixture', packageRoot: '/fixture', children: [] }]]),
    config: new Map([[owner, {}]]), resources: new Map([[owner, new Map([[endpointEventGatewayToken.id, { async run<T>(this: import('@zhin.js/adapter').EndpointEventGateway, receive: (receipt: import('@zhin.js/adapter').EndpointReceipt) => T | Promise<T>) { return receive(this); }, receive }]])]]), capabilities: new Map([[slot.id, slot]]), projections: new Map() };
  const index = await AdapterIndex.create([slot], createSnapshotView(0, state), new AbortController().signal);
  const store = new SnapshotStore({ ...state, projections: new Map([[adapterFeatureId, index]]) });
  cleanup.push(() => store.close(), () => index.stop());
  const endpoint = adapter.getEndpoint(adapter.list()[0]!.instanceId)!;
  return { index, adapter, endpoint, receive, id: slot.id };
}

describe('native Client events through the owning Adapter and symbol specification', () => {
  it('owns a single open-gated bridge, retains native event identity, and detaches on close/stop', async () => {
    const f = await fixture(), raw = { phase: 'open', nativeMethod: () => 'native-event' };
    expect(f.endpoint).toBeInstanceOf(NativeClient); expect(f.endpoint.emit).toBe(EventEmitter.prototype.emit);
    f.endpoint.emit('native.event', { phase: 'not-started' }); expect(f.receive).not.toHaveBeenCalled();
    await f.index.start(); f.endpoint.emit('native.event', { phase: 'closed' }); expect(f.receive).not.toHaveBeenCalled();
    f.index.open(); f.index.open(); expect(f.endpoint.listenerCount('native.event')).toBe(1);
    f.endpoint.emit('native.event', raw); await vi.waitFor(() => expect(f.receive).toHaveBeenCalledOnce());
    const event = f.receive.mock.calls[0]![0]; expect(event).toMatchObject({ name: 'platform.receive', payload: { name: 'native.event', event: raw } });
    expect(event.client).toBe(f.endpoint); expect((event.payload as { event: unknown }).event).toBe(raw);
    await f.index.close(); f.endpoint.emit('native.event', { phase: 'closed-again' }); expect(f.receive).toHaveBeenCalledOnce(); expect(f.endpoint.listenerCount('native.event')).toBe(0);
    f.index.open(); expect(f.endpoint.listenerCount('native.event')).toBe(1); await f.index.stop();
    f.endpoint.emit('native.event', { phase: 'retired' }); expect(f.receive).toHaveBeenCalledOnce(); expect(f.endpoint.listenerCount('native.event')).toBe(0);
  });
});

describe('the actual operation Client and explicit detached Index selection', () => {
  it('infers command/inbound middleware input without a second Client descriptor registry', async () => {
    const f = await fixture(); await f.index.start(); const lease = f.adapter.acquire(f.id);
    const input = { clientAdapter: 'native', get $client() { lease.assertActive(); return lease.endpoint; } };
    try {
      expect(readOperationClient({ input }, 'native')).toBe(f.endpoint);
      expect(readOperationClient(input, 'native')).toBe(f.endpoint); expect(f.endpoint.call('action')).toBe('action');
      expect(() => readOperationClient({ input }, 'other')).toThrow('Adapter other cannot access native Client');
    } finally { lease.release(); }
    expect(() => readOperationClient({ input }, 'native')).toThrow('retired');
  });
  it('resolves outbound middleware’s exact conversation Endpoint through the real Index', async () => {
    const f = await fixture(); expect(() => f.index.client('native', f.id)).toThrow('not active');
    await f.index.start(); const conversation = { endpoint: { id: f.id, adapter: 'native' }, kind: 'private', id: 'room' };
    expect(f.index.client('native', conversation.endpoint.id)).toBe(f.endpoint);
    expect(f.index.findClient('other', conversation.endpoint.id)).toBeUndefined();
    expect(() => f.index.client('other', conversation.endpoint.id)).toThrow('does not exist');
    await f.index.stop(); expect(f.index.findClient('native', f.id)).toBeUndefined();
  });
  it('uses the existing operation Client for IM tools and requires explicit detached Endpoint selection', async () => {
    const f = await fixture(); await f.index.start();
    expect(readOperationClient({ clientAdapter: 'native', $client: f.endpoint }, 'native')).toBe(f.endpoint);
    expect(() => readOperationClient({}, 'native')).toThrow('unavailable outside its IM operation');
    expect(readOperationClient({})).toBeUndefined();
    expect(f.index.client('native', f.id)).toBe(f.endpoint);
    expect(() => f.index.client('native', 'other-account')).toThrow('does not exist');
  });
});
