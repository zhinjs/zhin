import { createProviderResourceKey, ProviderBindingResourceOwner, defineProvider, resolveProviderProfile, normalizeProviderGraph } from '../../src/provider/index.js';
import { graphFixture, context, runtimeFixture } from '../provider/fixtures.js';

function fixture() {
  const graph = graphFixture(), driver = defineProvider({ id: 'fixture', contractVersion: '1', authentication: { methods: ['none'] },
    serviceSchema: { parse: (value: unknown) => value }, targets: () => ({ authentication: [], inference: [] }), models: service => service.models, createExecution: () => ({}) });
  const disposed: number[] = [], key = createProviderResourceKey<{ index: number }>('local-state');
  const owner = new ProviderBindingResourceOwner(() => undefined); let index = 0;
  const acquire = (selected = graph, selectedDriver = driver) => {
    const binding = resolveProviderProfile({ graph: selected, context, kind: 'language', purpose: 'chat' });
    owner.reconcile(selected); const lease = owner.acquire({ binding, driver: selectedDriver });
    return { lease, value: lease.resources.getOrCreate({ key, create: () => { const value = { index: ++index }; return { value, dispose: () => { disposed.push(value.index); } }; } }) };
  };
  return { graph, driver, owner, disposed, acquire };
}
it('shares only pure state across operations, keeps idle reuse and releases idempotently', () => {
  const f = fixture(), a = f.acquire(), b = f.acquire(); expect(a.value).toBe(b.value);
  a.lease.release(); a.lease.release(); b.lease.release(); expect(f.disposed).toEqual([]);
  const c = f.acquire(); expect(c.value).toBe(a.value); c.lease.release(); f.owner.retire(); expect(f.disposed).toEqual([1]);
});
it('keeps active old state until its final release while new settings create separate state', () => {
  const f = fixture(), a = f.acquire(), b = f.acquire();
  const nextGraph = normalizeProviderGraph({ ...f.graph, revision: 2, profiles: { ...f.graph.profiles, text: { ...f.graph.profiles.text, revision: 2, parameters: { temperature: 0.2 } } } });
  const next = f.acquire(nextGraph); expect(next.value).not.toBe(a.value);
  a.lease.release(); expect(f.disposed).toEqual([]); b.lease.release(); expect(f.disposed).toEqual([1]);
  next.lease.release(); f.owner.retire(); expect(f.disposed).toEqual([1, 2]);
});
it('prevents late old snapshots from retiring the newest idle state', () => {
  const f = fixture(), first = f.acquire(); first.lease.release();
  const graph = normalizeProviderGraph({ ...f.graph, revision: 2, profiles: { ...f.graph.profiles, text: { ...f.graph.profiles.text, revision: 2, parameters: { temperature: 0.2 } } } });
  const latest = f.acquire(graph); latest.lease.release(); const late = f.acquire(); late.lease.release();
  const current = f.acquire(graph); expect(current.value).toBe(latest.value); current.lease.release(); f.owner.retire();
});
it('retires an exact Driver without aborting active operations or reusing disposed state', () => {
  const f = fixture(), old = f.acquire(); f.owner.retireDriver(f.driver); expect(f.disposed).toEqual([]);
  old.lease.release(); expect(f.disposed).toEqual([1]);
  const late = f.acquire(); expect(late.value).not.toBe(old.value); late.lease.release(); expect(f.disposed).toEqual([1, 2]);
});
it('cancels failed acquisition before Driver creation and preserves independent surviving operations', async () => {
  const f = runtimeFixture(), controller = new AbortController(); controller.abort(new Error('cancelled'));
  await expect(f.runtime.openOperation({ context, signal: controller.signal })).rejects.toThrow('cancelled');
  expect(f.calls.created).toBe(0);
  const active = await f.runtime.openOperation({ context }); await active.generate({ request: { context: { messages: [] } } });
  expect(f.calls.created).toBe(1); await active.close();
});
