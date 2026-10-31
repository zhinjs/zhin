import { MemoryDesiredRepository } from '../../../../../plugins/adapters/test-utils/desired-repository.js';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Adapter, AdapterIndex, adapterFeatureId, createEndpointSpecification, defineAdapter, endpointSpec,
  endpointEventGatewayToken, type Endpoint } from '@zhin.js/adapter';
import { DataMigrationError, GenerationAdmissionGate, SnapshotStore, childPluginId, createCapabilitySlot, createSnapshotView, generationAdmissionSource,
  pluginDataMigrationProviderToken, rootPluginId, type DataMigrationPlan, type DataMigrationReceipt,
  type PluginDataMigrationProvider, type SnapshotState, type TokenId } from '@zhin.js/plugin-runtime';
import { DataMigrationController, DataMigrationPlanStore, type StoredDataMigrationPlan } from '../../../src/plugin-runtime/data-migration/index.js';

class TestEndpoint implements Endpoint {
  readonly [endpointSpec] = createEndpointSpecification(this, { start() {}, open() {}, close() {}, stop() {}, send: () => 'sent' });
}
class TestAdapter extends Adapter<TestEndpoint> { protected createEndpoint() { return new TestEndpoint(); } }
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanups.splice(0)) await close(); });
async function fixture(options: { failPhase?: StoredDataMigrationPlan['phase']; managed?: boolean } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'zhin-migration-controller-'));
  const root = rootPluginId(), child = childPluginId(root, 'child');
  let lastReceipt: DataMigrationReceipt | undefined;
  let data: 'not_applied' | 'applied' | 'restored' = 'not_applied';
  let maintenance: 'paused' | 'resumed' = 'resumed';
  const admission = new GenerationAdmissionGate();
  const before = 'private-before-image:'.repeat(10_000);
  const provider: PluginDataMigrationProvider = {
    title: 'Historical game records', [generationAdmissionSource]: [admission],
    preview: vi.fn(async () => ({ revision: '1', candidates: [] })),
    prepare: vi.fn(async request => ({ id: request.planId, candidateId: request.candidateId, domain: 'fixture', sourceVersion: 'old',
      beforeDigest: request.expectedDigest, target: request.target, recordCount: 2, data: { before },
      description: ['Move the selected two records'], authorizationCandidates: [{ oldGrant: 'must-not-activate' }] })),
    apply: vi.fn(async ({ plan }) => {
      const persisted = await store.read(plan.id);
      expect(persisted?.phase).toBe('applying'); expect(persisted?.plan.data).toEqual({ before });
      data = 'applied'; maintenance = 'paused'; lastReceipt = receipt(plan, 'apply'); return lastReceipt;
    }),
    inspect: vi.fn(async () => ({ data, maintenance, resumable: maintenance === 'paused', ...(lastReceipt ? { receipt: lastReceipt } : {}) })),
    resume: vi.fn(async () => { maintenance = 'resumed'; }),
    restore: vi.fn(async ({ plan }) => { data = 'restored'; maintenance = 'paused'; lastReceipt = receipt(plan, 'restore'); return lastReceipt; }),
  };
  class TestStore extends DataMigrationPlanStore {
    failPhase = options.failPhase;
    override async write(stored: StoredDataMigrationPlan) {
      if (stored.phase === this.failPhase) { this.failPhase = undefined; throw new Error('synthetic disk failure'); }
      return super.write(stored);
    }
  }
  const store = new TestStore({ directory });
  const slot = createCapabilitySlot({ owner: root, feature: adapterFeatureId, localName: 'test', source: '/fixture/adapters/test/index.ts',
    definition: defineAdapter({ capabilities: ['outbound'], createAdapter: () => new TestAdapter() }) });
  const resources = new Map<TokenId, unknown>([[endpointEventGatewayToken.id, { receive: async () => undefined }], [pluginDataMigrationProviderToken.id, provider]]);
  const state: SnapshotState = { root,
    tree: new Map([[root, { id: root, instanceKey: 'root', packageName: 'fixture', packageRoot: '/fixture', children: [child] }],
      [child, { id: child, instanceKey: 'child', packageName: 'fixture-child', packageRoot: '/fixture-child', parent: root, children: [] }]]),
    config: new Map([[root, { endpoints: options.managed ? [] : [{ id: 'account' }] }]]), capabilities: new Map([[slot.id, slot]]),
    resources: new Map([[root, resources], [child, new Map([[pluginDataMigrationProviderToken.id, provider]])]]), projections: new Map(),
  };
  const repository = new MemoryDesiredRepository();
  const index = await AdapterIndex.create([slot], createSnapshotView(1, state), new AbortController().signal, options.managed ? { repository } : {});
  const adapter = index.adapter(slot.id)!;
  if (options.managed) { await index.start(); await adapter.add(adapter.revision, { endpointId: 'account', config: { id: 'account' } }); }
  const snapshots = new SnapshotStore({ ...state, projections: new Map([[adapterFeatureId, index]]) });
  const controller = new DataMigrationController({ snapshots, store });
  const target = { endpoint: { adapter: index.clientAdapter(index.list()[0]!.id), id: String(index.list()[0]!.id) }, kind: 'group' as const, id: 'room' };
  const prepare = () => controller.prepare({ owner: root, candidateId: 'opaque-record', expectedDigest: 'before-sha', target });
  cleanups.push(async () => { await index.stop(); await snapshots.close(); await rm(directory, { recursive: true, force: true }); });
  return { root, child, directory, snapshots, index, adapter, repository, store, controller, provider, target, prepare, before, admission };
}
function receipt(plan: DataMigrationPlan, operation: 'apply' | 'restore'): DataMigrationReceipt {
  return { operation, planId: plan.id, candidateId: plan.candidateId, beforeDigest: plan.beforeDigest,
    afterDigest: `${operation}-sha`, recordCount: plan.recordCount, status: 'applied', maintenance: 'paused' };
}

it('discovers local providers without attributing an inherited resource to its child', async () => {
  const f = await fixture();
  expect(await f.controller.listProviders()).toEqual([{ owner: f.root, title: f.provider.title }]);
  await expect(f.controller.preview({ owner: f.child })).rejects.toMatchObject({ code: 'not_found' });
  await f.controller.preview({ owner: f.root }); expect(f.provider.preview).toHaveBeenCalledOnce();
});
it('saves full before-images privately before mutation, and returns a content-free projection', async () => {
  const f = await fixture(), summary = await f.prepare();
  expect(summary.phase).toBe('prepared'); expect(JSON.stringify(summary)).not.toContain(f.before);
  expect(summary.authorizationCandidateCount).toBe(1); expect(JSON.stringify(summary)).not.toContain('must-not-activate');
  const filename = path.join(f.directory, `${summary.planId}.json`);
  expect((await stat(f.directory)).mode & 0o777).toBe(0o700); expect((await stat(filename)).mode & 0o777).toBe(0o600);
  expect((await stat(filename)).size).toBeGreaterThan(64 * 1024);
  expect(JSON.parse(await readFile(filename, 'utf8')).plan.data).toEqual({ before: f.before });
  expect(f.index.describe()[0]!.connected).toBe(false);
  const restarted = new DataMigrationController({ snapshots: f.snapshots, store: new DataMigrationPlanStore({ directory: f.directory }) });
  expect(await restarted.read({ planId: summary.planId })).toEqual(summary);
  const [one, two] = await Promise.all([restarted.apply({ planId: summary.planId }), restarted.apply({ planId: summary.planId })]);
  expect(one.phase).toBe('applied'); expect(two.phase).toBe('applied'); expect(f.provider.apply).toHaveBeenCalledOnce();
  expect(f.provider.resume).not.toHaveBeenCalled();
});
it('rejects aliases, wrong Adapter identities and arbitrary plan paths before provider preparation', async () => {
  const f = await fixture();
  for (const endpoint of [{ adapter: f.target.endpoint.adapter, id: 'account' }, { adapter: 'foreign', id: f.target.endpoint.id }]) {
    await expect(f.controller.prepare({ owner: f.root, candidateId: 'opaque-record', expectedDigest: 'before-sha', target: { ...f.target, endpoint } }))
      .rejects.toMatchObject({ code: 'invalid_input' });
  }
  await expect(f.controller.apply({ planId: '../stolen' })).rejects.toMatchObject({ code: 'invalid_input' });
  expect(f.provider.prepare).not.toHaveBeenCalled();
});
it('does not enter the domain when its durable intent cannot be written', async () => {
  const f = await fixture({ failPhase: 'applying' }), summary = await f.prepare();
  await expect(f.controller.apply({ planId: summary.planId })).rejects.toThrow('synthetic disk failure');
  expect(f.provider.apply).not.toHaveBeenCalled(); expect((await f.store.read(summary.planId))!.phase).toBe('prepared');
});
it('reconciles a lost receipt through pure lookup instead of replaying a committed apply', async () => {
  const f = await fixture({ failPhase: 'applied' }), summary = await f.prepare();
  await expect(f.controller.apply({ planId: summary.planId })).rejects.toMatchObject({ code: 'commit_unknown' });
  expect((await f.store.read(summary.planId))!.phase).toBe('commit_unknown');
  await expect(f.controller.apply({ planId: summary.planId })).rejects.toMatchObject({ code: 'commit_unknown' });
  expect(f.provider.apply).toHaveBeenCalledOnce();
  const confirmed = await f.controller.reconcile({ planId: summary.planId }); expect(confirmed.phase).toBe('applied');
  expect(f.provider.inspect).toHaveBeenCalledOnce(); expect(f.provider.apply).toHaveBeenCalledOnce();
  expect((await f.controller.resume({ planId: summary.planId })).phase).toBe('resumed');
  await f.controller.resume({ planId: summary.planId }); expect(f.provider.resume).toHaveBeenCalledOnce();
});
it('retains unknown on receipt lookup errors and never treats an old apply as a confirmed restore', async () => {
  const f = await fixture(), summary = await f.prepare(); await f.controller.apply({ planId: summary.planId });
  vi.mocked(f.provider.restore).mockRejectedValueOnce(new Error('synthetic lost restore response'));
  await expect(f.controller.restore({ planId: summary.planId })).rejects.toMatchObject({ code: 'commit_unknown' });
  vi.mocked(f.provider.inspect).mockRejectedValueOnce(new Error('synthetic lookup error'));
  await expect(f.controller.reconcile({ planId: summary.planId })).rejects.toThrow('synthetic lookup error');
  const inspected = await f.controller.reconcile({ planId: summary.planId });
  expect(inspected.phase).toBe('applied'); expect(inspected.receipt?.operation).toBe('apply');
  expect(f.provider.restore).toHaveBeenCalledOnce(); expect((await f.store.read(summary.planId))!.phase).not.toBe('restored');
});
it('restores once only after a confirmed application and remains paused', async () => {
  const f = await fixture(), summary = await f.prepare();
  await expect(f.controller.restore({ planId: summary.planId })).rejects.toMatchObject({ code: 'conflict' });
  await f.controller.apply({ planId: summary.planId });
  const result = await f.controller.restore({ planId: summary.planId }); expect(result.phase).toBe('restored');
  expect(result.receipt?.operation).toBe('restore');
  await f.controller.restore({ planId: summary.planId }); expect(f.provider.restore).toHaveBeenCalledOnce();
  expect(f.provider.resume).not.toHaveBeenCalled();
});
it('distinguishes a corrupt file from a missing plan, and never dispatches a provider for either', async () => {
  const f = await fixture(), summary = await f.prepare();
  await writeFile(path.join(f.directory, `${summary.planId}.json`), '{broken');
  await expect(f.controller.read({ planId: summary.planId })).rejects.toThrow(SyntaxError);
  await expect(f.controller.read({ planId: '00000000-0000-0000-0000-000000000001' })).rejects.toMatchObject({ code: 'not_found' });
  expect(f.provider.apply).not.toHaveBeenCalled();
});

it('preserves a confirmed no-commit error and explicitly resumes an inspected paused original scope', async () => {
  const f = await fixture(), summary = await f.prepare();
  vi.mocked(f.provider.apply).mockRejectedValueOnce(new DataMigrationError('conflict', 'before-image changed'));
  await expect(f.controller.apply({ planId: summary.planId })).rejects.toMatchObject({ code: 'conflict' });
  expect((await f.store.read(summary.planId))!.phase).toBe('inspection_required');
  vi.mocked(f.provider.inspect).mockResolvedValueOnce({ data: 'not_applied', maintenance: 'paused', resumable: true });
  const resumed = await f.controller.resume({ planId: summary.planId });
  expect(resumed.phase).toBe('resumed'); expect(resumed.receipt).toBeUndefined();
  expect(f.provider.resume).toHaveBeenCalledOnce(); expect(f.provider.apply).toHaveBeenCalledOnce();
});
it('reconciles a lost resume response from authoritative maintenance, without replaying resume', async () => {
  const f = await fixture(), summary = await f.prepare(); await f.controller.apply({ planId: summary.planId });
  vi.mocked(f.provider.resume).mockRejectedValueOnce(new Error('synthetic lost resume response'));
  await expect(f.controller.resume({ planId: summary.planId })).rejects.toMatchObject({ code: 'commit_unknown' });
  expect((await f.store.read(summary.planId))!.phase).toBe('resume_unknown');
  const committed = (await f.store.read(summary.planId))!.receipt!;
  vi.mocked(f.provider.inspect).mockResolvedValueOnce({ data: 'applied', maintenance: 'resumed', resumable: false, receipt: committed });
  const inspected = await f.controller.reconcile({ planId: summary.planId });
  expect(inspected.phase).toBe('resumed'); expect(f.provider.resume).toHaveBeenCalledOnce();
});
it('keeps unprovable or divergent inspected state unresolved instead of authorizing resume', async () => {
  const f = await fixture(), summary = await f.prepare();
  vi.mocked(f.provider.inspect).mockResolvedValueOnce({ data: 'unknown', maintenance: 'unknown', resumable: false });
  await expect(f.controller.resume({ planId: summary.planId })).rejects.toMatchObject({ code: 'commit_unknown' });
  vi.mocked(f.provider.inspect).mockResolvedValueOnce({ data: 'conflict', maintenance: 'paused', resumable: false });
  await expect(f.controller.resume({ planId: summary.planId })).rejects.toMatchObject({ code: 'conflict' });
  expect(f.provider.resume).not.toHaveBeenCalled();
});
it('holds the provider admission for the complete await and cancels it on explicit Root stop', async () => {
  const f = await fixture();
  let enter!: () => void, finish!: () => void, signal: AbortSignal | undefined;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const finished = new Promise<void>(resolve => { finish = resolve; });
  const originalAcquire = f.admission.acquire.bind(f.admission), release = vi.fn();
  const acquire = vi.spyOn(f.admission, 'acquire').mockImplementation(() => {
    const admitted = originalAcquire();
    return admitted ? () => { release(); admitted(); } : undefined;
  });
  vi.mocked(f.provider.preview).mockImplementationOnce(async request => {
    signal = request?.signal; enter(); await finished; return { revision: '1', candidates: [] };
  });
  const running = f.controller.preview({ owner: f.root }); await entered;
  expect(acquire).toHaveBeenCalledOnce(); expect(release).not.toHaveBeenCalled();
  const closing = f.snapshots.close();
  expect(signal?.aborted).toBe(true); expect(f.admission.active).toBe(false);
  finish(); await running; await closing; expect(release).toHaveBeenCalledOnce();
});
it('retains the admitted provider through unrelated HMR without cancelling or replaying its request', async () => {
  const f = await fixture();
  let enter!: () => void, finish!: () => void, signal: AbortSignal | undefined;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const finished = new Promise<void>(resolve => { finish = resolve; });
  const originalAcquire = f.admission.acquire.bind(f.admission), release = vi.fn();
  vi.spyOn(f.admission, 'acquire').mockImplementation(() => {
    const admitted = originalAcquire();
    return admitted ? () => { release(); admitted(); } : undefined;
  });
  vi.mocked(f.provider.preview).mockImplementationOnce(async request => {
    signal = request?.signal; enter(); await finished; signal?.throwIfAborted(); return { revision: 'original', candidates: [] };
  });
  const running = f.controller.preview({ owner: f.root }); await entered;
  const state = f.snapshots.current;
  f.snapshots.commit(state.generation, { snapshot: { ...state, resources: new Map() }, dispose: () => undefined });
  try {
    expect(f.admission.active).toBe(false);
    expect(release).not.toHaveBeenCalled();
    expect(signal?.aborted).toBe(false);
  } finally { finish(); }
  await expect(running).resolves.toEqual({ revision: 'original', candidates: [] });
  expect(release).toHaveBeenCalledOnce();
  expect(f.provider.preview).toHaveBeenCalledOnce();
  await expect(f.controller.preview({ owner: f.root })).rejects.toMatchObject({ code: 'not_found' });
});

it('retains caller cancellation for an accepted migration provider request', async () => {
  const f = await fixture(), caller = new AbortController();
  let enter!: () => void, finish!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const finished = new Promise<void>(resolve => { finish = resolve; });
  vi.mocked(f.provider.preview).mockImplementationOnce(async request => {
    enter(); await finished; request?.signal?.throwIfAborted(); return { revision: '1', candidates: [] };
  });
  const running = f.controller.preview({ owner: f.root, signal: caller.signal }); await entered;
  caller.abort(new Error('caller cancelled')); finish();
  await expect(running).rejects.toThrow('caller cancelled');
  expect(f.provider.preview).toHaveBeenCalledOnce();
});
it('refuses a retired provider gate before invoking its methods', async () => {
  const f = await fixture(); vi.spyOn(f.admission, 'acquire').mockReturnValueOnce(undefined);
  await expect(f.controller.preview({ owner: f.root })).rejects.toMatchObject({ code: 'unavailable' });
  expect(f.provider.preview).not.toHaveBeenCalled();
});

it('releases verified maintenance after a rolled-back conflicting restore without changing any domain records', async () => {
  const f = await fixture(), summary = await f.prepare(); await f.controller.apply({ planId: summary.planId });
  vi.mocked(f.provider.restore).mockRejectedValueOnce(new DataMigrationError('conflict', 'after-image changed by normal work'));
  await expect(f.controller.restore({ planId: summary.planId })).rejects.toMatchObject({ code: 'conflict' });
  expect((await f.store.read(summary.planId))!.phase).toBe('inspection_required');
  vi.mocked(f.provider.inspect).mockResolvedValueOnce({ data: 'conflict', maintenance: 'paused', resumable: true });
  const resumed = await f.controller.resume({ planId: summary.planId });
  expect(resumed.phase).toBe('resumed'); expect(resumed.inspection?.data).toBe('conflict');
  expect(f.provider.restore).toHaveBeenCalledOnce(); expect(f.provider.apply).toHaveBeenCalledOnce();
  expect(f.provider.resume).toHaveBeenCalledOnce(); expect((await f.store.read(summary.planId))!.plan.data).toEqual({ before: f.before });
});

it('durably records already-resumed maintenance even when later domain work invalidates the old plan image', async () => {
  const f = await fixture(), summary = await f.prepare(); await f.controller.apply({ planId: summary.planId });
  vi.mocked(f.provider.inspect).mockResolvedValueOnce({ data: 'conflict', maintenance: 'resumed', resumable: false });
  const result = await f.controller.resume({ planId: summary.planId });
  expect(result.phase).toBe('resumed'); expect(result.inspection?.data).toBe('conflict');
  expect((await f.store.read(summary.planId))!.phase).toBe('resumed'); expect(f.provider.resume).not.toHaveBeenCalled();
});

it.each(['remove', 'replace'] as const)('refuses to apply a prepared plan after its exact account is %s', async action => {
  const f = await fixture({ managed: true }), summary = await f.prepare(), account = f.adapter.list()[0]!;
  if (action === 'remove') await f.adapter.remove(account.instanceId, f.adapter.revision);
  else await f.adapter.replace(account.instanceId, f.adapter.revision, { endpointId: 'account', config: { id: 'replacement' } });
  expect(f.adapter.list().some(row => row.canonicalId === summary.target.endpoint.id)).toBe(false);
  await expect(f.controller.apply({ planId: summary.planId })).rejects.toMatchObject({ code: 'not_found' });
  expect(f.provider.apply).not.toHaveBeenCalled(); expect((await f.store.read(summary.planId))!.phase).toBe('prepared');
  expect(f.adapter.list().every(row => !row.started)).toBe(true);
});
it('permits recovery of already-held data and paused maintenance after the target account was removed', async () => {
  const f = await fixture({ managed: true }), summary = await f.prepare(); await f.controller.apply({ planId: summary.planId });
  await f.adapter.remove(f.adapter.list()[0]!.instanceId, f.adapter.revision);
  expect((await f.controller.restore({ planId: summary.planId })).phase).toBe('restored');
  expect((await f.controller.resume({ planId: summary.planId })).phase).toBe('resumed');
  expect(f.provider.restore).toHaveBeenCalledOnce(); expect(f.provider.resume).toHaveBeenCalledOnce();
});
