import { bindPlatformEndpoint } from '../../src/endpoint-specification.js';
import { EventEmitter } from 'node:events';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { capabilityId, featureId, rootPluginId, type CapabilityId, type RuntimeSnapshot, type TokenId, createCapabilitySlot } from '@zhin.js/plugin-runtime';
import { Adapter, AdapterIndex, AdapterManagementError, endpointEventGatewayToken, createEndpointSpecification, endpointSpec,
  defineAdapter, parseAdapterDefinition, type EndpointCreationContext, type EndpointDesiredRepository, type EndpointDesiredSnapshot,
  type EndpointDesiredRecord, type EndpointPreviousIdentity, type EndpointConnectionInfo, type Endpoint } from '../../src/index.js';

const adapterId = capabilityId(rootPluginId(), featureId('zhin.adapter'), 'native');
function gate<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
class Repository implements EndpointDesiredRepository {
  state?: EndpointDesiredSnapshot;
  load = vi.fn(async () => this.state);
  compareAndSet = vi.fn(async (_adapter: CapabilityId, revision: number | null, endpoints: readonly EndpointDesiredRecord[], commitId?: string) => {
    if ((this.state?.revision ?? null) !== revision) throw new AdapterManagementError('conflict', 'conflict');
    this.state = structuredClone({ revision: (revision ?? 0) + 1, endpoints, ...(commitId ? { commitId } : {}) });
    return this.state;
  });
}
class NativeClient extends EventEmitter {
  readonly nativeCalls: string[] = [];
  nativeMethod(value: string): number { this.nativeCalls.push(value); return this.nativeCalls.length; }
}
class NativeEndpoint extends NativeClient implements Endpoint {
  readonly listed = vi.fn(async () => []);
  readonly recalled = vi.fn(async () => undefined);
  readonly stopped = vi.fn(async () => undefined);
  readonly connected = vi.fn(async (_signal: AbortSignal): Promise<void> => undefined);
  readonly sent = vi.fn(async () => 'message-id');
  readonly [endpointSpec] = createEndpointSpecification(this, {
    start: signal => this.connected(signal), open: () => undefined, close: async () => undefined,
    stop: () => this.stopped(), send: () => this.sent(),
    management: { listGroups: () => this.listed() }, control: { recall: () => this.recalled() },
  });
}
class NativeAdapter extends Adapter<NativeEndpoint, Record<string, unknown>, { message: { text: string } }> {
  readonly created: NativeEndpoint[] = [];
  connect?: (endpoint: NativeEndpoint) => void;
  protected createEndpoint(_config: Record<string, unknown>, _context: EndpointCreationContext): NativeEndpoint {
    const endpoint = new NativeEndpoint(); this.created.push(endpoint); this.connect?.(endpoint); return endpoint;
  }
}
async function create(repository = new Repository(), adapter = new NativeAdapter()) {
  await adapter.initialize({ descriptor: { id: adapterId, owner: rootPluginId(), name: 'native', source: 'fixture', capabilities: ['inbound', 'outbound'] },
    repository, initial: [], bind(endpoint, record) {
      bindPlatformEndpoint(endpoint, { id: record.canonicalId, name: 'native', use: () => ({ receive: async () => undefined }) } as never);
      return [];
    } }, new AbortController().signal);
  await adapter.activate(new AbortController().signal);
  adapter.open();
  return { adapter, repository };
}
async function add(adapter: NativeAdapter, name: string) {
  const result = await adapter.add(adapter.revision, { endpointId: name, config: { name, password: 'private-fixture' } });
  return result.endpoints.find(endpoint => endpoint.endpointId === name)!;
}

class SocketClient {
  readonly writes: string[] = [];
  send(data: string): number { this.writes.push(data); return this.writes.length; }
}
class SocketEndpoint extends SocketClient implements Endpoint {
  readonly [endpointSpec] = createEndpointSpecification(this, {
    start: async () => undefined, open: () => undefined, close: () => undefined, stop: () => undefined,
    send: async request => { this.send(String(request.payload)); return 'socket-message'; },
  });
}
class SocketAdapter extends Adapter<SocketEndpoint> {
  protected createEndpoint(): SocketEndpoint { return new SocketEndpoint(); }
}

describe('Adapter-owned native Endpoint runtime', () => {
  it('accepts the class-based Adapter at actual convention-definition validation', () => {
    const definition = defineAdapter({ capabilities: ['outbound'], createAdapter: () => new NativeAdapter() });
    expect(parseAdapterDefinition(definition)).toBe(definition);
  });

  it('defers repository reads to activation and never constructs a legacy account disabled by persisted state', async () => {
    const repository = new Repository();
    const legacy: EndpointDesiredRecord = { instanceId: 'legacy', canonicalId: adapterId,
      endpointId: 'old-name', revision: 1, desiredEnabled: true, config: {} };
    repository.state = { revision: 4, endpoints: [{ ...legacy, desiredEnabled: false }] };
    const adapter = new NativeAdapter();
    await adapter.initialize({ descriptor: { id: adapterId, owner: rootPluginId(), name: 'native', source: 'fixture', capabilities: ['inbound', 'outbound'] },
      repository, initial: [legacy], bind: () => [] }, new AbortController().signal);
    expect(repository.load).not.toHaveBeenCalled();
    expect(adapter.created).toHaveLength(0);
    await adapter.activate(new AbortController().signal);
    expect(repository.load).toHaveBeenCalledTimes(1);
    expect(adapter.created).toHaveLength(0);
    expect(adapter.list()[0].desiredEnabled).toBe(false);
    await adapter.dispose();
  });

  it('loads absence without an initialization write; add saves disabled configuration without constructing SDK objects or exposing configuration', async () => {
    const { adapter, repository } = await create();
    expect(repository.compareAndSet).not.toHaveBeenCalled();
    const record = await add(adapter, 'one');
    expect(adapter.created).toHaveLength(0);
    expect(record.desiredEnabled).toBe(false);
    expect(JSON.stringify(adapter.list())).not.toContain('private-fixture');
    expect(record).not.toHaveProperty('config');
    await adapter.dispose();
  });

  it('retains identity validation after the first authoritative restore', async () => {
    const { adapter, repository } = await create(); const target = await add(adapter, 'one');
    repository.compareAndSet.mockImplementationOnce(async (_id, revision, endpoints) => ({ revision: (revision ?? 0) + 1,
      endpoints: endpoints.map(record => record.instanceId === target.instanceId ? { ...record, endpointId: 'changed' } : record) }));
    await expect(adapter.add(adapter.revision, { endpointId: 'two', config: {} })).rejects.toMatchObject({ code: 'invalid_configuration' });
    expect(adapter.list()).toHaveLength(1);
    expect(adapter.list()[0].endpointId).toBe('one');
    await adapter.dispose();
  });

  it('reconnects only the updated account, cancels and drains its old lease, and rejects stale source incarnations', async () => {
    const { adapter } = await create();
    const one = await add(adapter, 'one'), two = await add(adapter, 'two');
    await adapter.start(one.instanceId, adapter.revision);
    await adapter.start(two.instanceId, adapter.revision);
    const first = adapter.getEndpoint(one.instanceId)!;
    const second = adapter.getEndpoint(two.instanceId)!;
    const lease = adapter.acquire(one.canonicalId, undefined, first);
    const updated = adapter.update(one.instanceId, adapter.revision, { config: { changed: true } });
    await vi.waitFor(() => expect(lease.signal.aborted).toBe(true));
    await expect(lease.send({ conversation: { endpoint: { id: one.canonicalId, adapter: 'native' }, kind: 'private', id: 'user' }, payload: 'late' })).rejects.toMatchObject({ disposition: 'not_sent' });
    expect(first.stopped).not.toHaveBeenCalled();
    expect(adapter.getEndpoint(two.instanceId)).toBe(second);
    lease.release();
    expect((await updated).execution.status).toBe('applied');
    expect(first.stopped).toHaveBeenCalledTimes(1);
    expect(adapter.getEndpoint(one.instanceId)).not.toBe(first);
    expect(() => adapter.acquire(one.canonicalId, undefined, first)).toThrow(/incarnation/);
    await adapter.dispose();
  });

  it('stops an account while its login readiness is pending without blocking another account', async () => {
    const { adapter } = await create();
    const one = await add(adapter, 'one');
    const readiness = gate<void>();
    adapter.connect = endpoint => { endpoint.connected.mockImplementation(() => readiness.promise); };
    const starting = adapter.start(one.instanceId, adapter.revision);
    await vi.waitFor(() => expect(adapter.created[0]?.connected).toHaveBeenCalled());
    const stopped = await adapter.stop(one.instanceId, adapter.revision);
    expect(stopped.execution.status).toBe('applied');
    expect((await starting).execution.status).toBe('failed');
    expect(adapter.created[0].stopped).toHaveBeenCalledTimes(1);
    readiness.resolve();
    await adapter.dispose();
  });

  it('shares the same pending login when explicit start is repeated at a newer desired revision', async () => {
    const { adapter } = await create(); const record = await add(adapter, 'one');
    const ready = gate<void>();
    adapter.connect = endpoint => { endpoint.connected.mockImplementation(() => ready.promise); };
    const first = adapter.start(record.instanceId, adapter.revision);
    await vi.waitFor(() => expect(adapter.created[0]?.connected).toHaveBeenCalledTimes(1));
    const second = adapter.start(record.instanceId, adapter.revision);
    await vi.waitFor(() => expect(adapter.revision).toBe(3));
    await Promise.resolve(); await Promise.resolve();
    expect(adapter.created[0].connected).toHaveBeenCalledTimes(1);
    ready.resolve(); await first; await second; await adapter.dispose();
  });

  it('keeps a replacement incarnation alive when its retired login settles late', async () => {
    const { adapter } = await create();
    const one = await add(adapter, 'one');
    const readiness = gate<void>();
    adapter.connect = endpoint => {
      if (adapter.created.length === 1) endpoint.connected.mockImplementation(() => readiness.promise);
    };
    const original = adapter.start(one.instanceId, adapter.revision);
    await vi.waitFor(() => expect(adapter.created[0]?.connected).toHaveBeenCalled());
    const updated = await adapter.update(one.instanceId, adapter.revision, { config: { replaced: true } });
    expect(updated.execution.status).toBe('applied');
    expect(adapter.getEndpoint(one.instanceId)).toBe(adapter.created[1]);
    expect(adapter.created[1].stopped).not.toHaveBeenCalled();
    expect((await original).execution.status).toBe('failed');
    readiness.resolve();
    await adapter.dispose();
  });

  it('does not reconnect a removed account when an earlier update finishes draining its old incarnation', async () => {
    const { adapter } = await create(); const record = await add(adapter, 'one');
    await adapter.start(record.instanceId, adapter.revision);
    const lease = adapter.acquire(record.canonicalId);
    const updating = adapter.update(record.instanceId, adapter.revision, { config: { changed: true } });
    await vi.waitFor(() => expect(lease.signal.aborted).toBe(true));
    const removing = adapter.remove(record.instanceId, adapter.revision);
    await vi.waitFor(() => expect(adapter.list()).toHaveLength(0));
    lease.release(); await removing; await updating;
    expect(adapter.created).toHaveLength(1);
    expect(adapter.list()).toHaveLength(0);
    await adapter.dispose();
  });

  it('allocates a new canonical identity on same-name recreation and preserves saved desired state on restart', async () => {
    const { adapter, repository } = await create();
    const old = await add(adapter, 'one');
    await adapter.start(old.instanceId, adapter.revision);
    await adapter.remove(old.instanceId, adapter.revision);
    const replacement = await add(adapter, 'one');
    expect(replacement.instanceId).not.toBe(old.instanceId);
    expect(replacement.canonicalId).not.toBe(old.canonicalId);
    await adapter.dispose();
    const restarted = (await create(repository)).adapter;
    expect(restarted.list()[0].instanceId).toBe(replacement.instanceId);
    expect(restarted.created).toHaveLength(0);
    expect(restarted.list()[0].desiredEnabled).toBe(false);
    await restarted.dispose();
  });

  it('keeps logical identity across Adapter reconstruction but allocates a new actual incarnation even when epoch restarts at one', async () => {
    const { adapter, repository } = await create(); const record = await add(adapter, 'one');
    await adapter.start(record.instanceId, adapter.revision);
    const first = adapter.acquire(record.canonicalId);
    const before = { epoch: first.epoch, incarnationId: first.incarnationId };
    first.release(); await adapter.dispose();
    const restarted = (await create(repository)).adapter;
    const second = restarted.acquire(record.canonicalId);
    expect(second.instanceId).toBe(record.instanceId);
    expect(second.canonicalId).toBe(record.canonicalId);
    expect(before.epoch).toBe(1); expect(second.epoch).toBe(1);
    expect(second.incarnationId).not.toBe(before.incarnationId);
    expect(restarted.list()[0].incarnationId).toBe(second.incarnationId);
    second.release(); await restarted.dispose();
  });

  it('reports saved intent separately from connection failure and does not retry unknown persistence', async () => {
    const { adapter, repository } = await create();
    const one = await add(adapter, 'one');
    adapter.connect = endpoint => { endpoint.connected.mockRejectedValue(new Error('private SDK details')); };
    const failed = await adapter.start(one.instanceId, adapter.revision);
    expect(failed.execution).toEqual({ status: 'failed', code: 'endpoint_execution_failed' });
    expect(repository.state!.endpoints[0].desiredEnabled).toBe(true);
    expect(JSON.stringify(failed)).not.toContain('private');
    const failure = new Error('unknown commit');
    repository.compareAndSet.mockRejectedValueOnce(failure);
    const previousCalls = repository.compareAndSet.mock.calls.length;
    await expect(adapter.stop(one.instanceId, adapter.revision)).rejects.toBe(failure);
    expect(repository.compareAndSet.mock.calls.length).toBe(previousCalls + 1);
    await adapter.dispose();
  });

  it.each(['other-commit', 'other-records', 'other-revision', 'absent', 'legacy-payload'] as const)(
    'keeps an unknown commit blocked after %s and admits only its exact proof once', async variant => {
      const { adapter, repository } = await create(); const target = await add(adapter, 'one');
      const persist = repository.compareAndSet.getMockImplementation()!;
      repository.compareAndSet.mockImplementationOnce(async (...args) => {
        await persist(...args); throw new AdapterManagementError('commit_unknown', 'unknown');
      });
      await expect(adapter.start(target.instanceId, adapter.revision)).rejects.toMatchObject({ code: 'commit_unknown' });
      const own = structuredClone(repository.state!);
      if (variant === 'absent') repository.state = undefined;
      else if (variant === 'other-commit') repository.state = { ...own, commitId: 'other-actor' };
      else if (variant === 'other-records') repository.state = { ...own, endpoints: [{ ...own.endpoints[0], config: { changed: true } }] };
      else if (variant === 'other-revision') repository.state = { ...own, revision: own.revision + 1 };
      else { const { commitId: _commitId, ...legacy } = own; repository.state = legacy; }
      const writes = repository.compareAndSet.mock.calls.length;
      await expect(adapter.verifyPendingCommit()).rejects.toMatchObject({ code: 'commit_unknown' });
      expect(() => adapter.stop(target.instanceId, adapter.revision)).toThrowError(AdapterManagementError);
      expect(adapter.created).toHaveLength(0);
      repository.state = own;
      const reads = repository.load.mock.calls.length;
      await Promise.all([adapter.verifyPendingCommit(), adapter.verifyPendingCommit()]);
      await vi.waitFor(() => expect(adapter.lastMutation?.status).toBe('applied'));
      expect(repository.load.mock.calls.length).toBe(reads + 1);
      expect(repository.compareAndSet.mock.calls.length).toBe(writes);
      expect(adapter.created).toHaveLength(1);
      expect(adapter.created[0].connected).toHaveBeenCalledOnce();
      await adapter.verifyPendingCommit();
      expect(adapter.created[0].connected).toHaveBeenCalledOnce();
      await adapter.dispose();
    });
  it('projects dynamic membership from the owning Adapter and keeps management/control handles on their captured incarnation', async () => {
    const repository = new Repository(); repository.state = { revision: 0, endpoints: [] };
    const adapter = new NativeAdapter();
    const root = rootPluginId();
    const slot = createCapabilitySlot({ owner: root, feature: featureId('zhin.adapter'), localName: 'native', source: 'fixture',
      definition: defineAdapter({ capabilities: ['inbound', 'outbound'], operations: ['recall'], createAdapter: () => adapter }) });
    const snapshot: RuntimeSnapshot = { generation: 0, root,
      tree: new Map([[root, { id: root, instanceKey: 'root', packageName: 'fixture', packageRoot: '/fixture', children: [] }]]),
      config: new Map([[root, {}]]), capabilities: new Map([[slot.id, slot]]), projections: new Map(),
      resources: new Map([[root, new Map<TokenId, unknown>([
        [endpointEventGatewayToken.id, { receive: async () => undefined }],
      ])]]),
    };
    const index = await AdapterIndex.create([slot], snapshot, new AbortController().signal, { repository });
    await index.activate(new AbortController().signal);
    const one = await add(adapter, 'one'); await adapter.start(one.instanceId, adapter.revision);
    const original = adapter.getEndpoint(one.instanceId)!;
    expect(index.adapterForEndpoint(one.canonicalId)).toBe(adapter);
    expect(index.client('native', 'one')).toBe(original);
    expectTypeOf(index.connection).returns.toEqualTypeOf<EndpointConnectionInfo | undefined>();
    const metadata = index.connection('native', 'one')!;
    expect(metadata.identity.id).toBe(one.canonicalId);
    expect(Object.isFrozen(metadata)).toBe(true);
    expect(Object.isFrozen(metadata.identity)).toBe(true);
    expect(Object.keys(metadata).sort()).toEqual(['eventDiagnostics', 'identity', 'name', 'selfUserId', 'transportState']);
    expect(Reflect.get(metadata, 'client')).toBeUndefined();
    expect(Reflect.get(metadata, 'management')).toBeUndefined();
    expect(Reflect.get(metadata, 'start')).toBeUndefined();
    expect(index.management(one.canonicalId)).toBeDefined();
    expect(metadata.selfUserId).toBeUndefined();
    expect(index.resolve('native', 'one')).toBe(one.canonicalId);
    const enumeration = vi.spyOn(adapter, 'runtimeEntries');
    expect(index.owner(one.canonicalId)).toBe(root);
    expect(index.clientAdapter(one.canonicalId)).toBe('native');
    expect(index.capabilities(one.canonicalId)).toBeDefined();
    expect(index.resolve('native', one.canonicalId)).toBe(one.canonicalId);
    const exactLease = index.acquire(one.canonicalId, undefined, original); exactLease.release();
    expect(enumeration).not.toHaveBeenCalled();
    const control = index.control(one.canonicalId, 'recall')!;
    const message = { conversation: { endpoint: { id: one.canonicalId, adapter: 'native' }, kind: 'private' as const, id: 'user' }, id: 'msg' };
    await control.recall!(message); expect(original.recalled).toHaveBeenCalledTimes(1);
    const listing = gate<never[]>(); original.listed.mockImplementationOnce(() => listing.promise);
    const managed = index.management(one.canonicalId)!;
    const lookup = managed.listGroups!();
    let stopped = false;
    const stopping = adapter.stop(one.instanceId, adapter.revision).then(result => { stopped = true; return result; });
    await vi.waitFor(() => expect(adapter.list()[0].admitted).toBe(false));
    expect(stopped).toBe(false);
    listing.resolve([]); await lookup; await stopping;
    await adapter.start(one.instanceId, adapter.revision);
    await expect(control.recall!(message)).rejects.toMatchObject({ disposition: 'not_sent' });
    await expect(managed.listGroups!()).rejects.toMatchObject({ disposition: 'not_sent' });
    await adapter.remove(one.instanceId, adapter.revision);
    expect(index.resolve('native', 'one')).toBeUndefined();
    const recreated = await add(adapter, 'one');
    expect(index.resolve('native', 'one')).toBe(recreated.canonicalId);
    expect(recreated.canonicalId).not.toBe(one.canonicalId);
    expect(adapter.find(one.canonicalId)).toBeUndefined();
    expect(adapter.find(recreated.canonicalId)?.desired.instanceId).toBe(recreated.instanceId);
    await index.stop();
  });

  it('drains a pending-start native receipt before SDK shutdown even before a canonical lease exists', async () => {
    const { adapter } = await create();
    const ready = gate<void>(), normalization = gate<void>();
    adapter.connect = endpoint => { endpoint.connected.mockImplementation(() => ready.promise); };
    const target = await add(adapter, 'pending-receipt');
    await adapter.start(target.instanceId, adapter.revision, { waitForExecution: false });
    await vi.waitFor(() => expect(adapter.created[0]?.connected).toHaveBeenCalledOnce());
    const endpoint = adapter.created[0];
    const receipt = endpoint[endpointSpec].events.run(() => normalization.promise);
    try {
      await adapter.stop(target.instanceId, adapter.revision, { waitForExecution: false });
      await vi.waitFor(() => expect(adapter.getEndpoint(target.instanceId)).toBeUndefined());
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(endpoint.stopped).not.toHaveBeenCalled();
    } finally {
      normalization.resolve(); ready.resolve(); await receipt;
      await vi.waitFor(() => expect(endpoint.stopped).toHaveBeenCalledOnce());
      await adapter.dispose();
    }
  });

  it('captures an exact pending inbound source while keeping send and management ready-gated and draining its lease', async () => {
    const repository = new Repository(), adapter = new NativeAdapter(), root = rootPluginId();
    repository.state = { revision: 0, endpoints: [] };
    const ready = gate<void>(); adapter.connect = endpoint => { endpoint.connected.mockImplementation(() => ready.promise); };
    const slot = createCapabilitySlot({ owner: root, feature: featureId('zhin.adapter'), localName: 'native', source: 'fixture',
      definition: defineAdapter({ capabilities: ['inbound', 'outbound'], operations: ['recall'], createAdapter: () => adapter }) });
    const snapshot: RuntimeSnapshot = { generation: 0, root,
      tree: new Map([[root, { id: root, instanceKey: 'root', packageName: 'fixture', packageRoot: '/fixture', children: [] }]]),
      config: new Map([[root, {}]]), capabilities: new Map([[slot.id, slot]]), projections: new Map(),
      resources: new Map([[root, new Map<TokenId, unknown>([[endpointEventGatewayToken.id, { receive: async () => undefined }]])]]) };
    const index = await AdapterIndex.create([slot], snapshot, new AbortController().signal, { repository });
    await index.activate(new AbortController().signal);
    const target = await add(adapter, 'pending');
    await adapter.start(target.instanceId, adapter.revision, { waitForExecution: false });
    await vi.waitFor(() => expect(adapter.created[0]?.connected).toHaveBeenCalledOnce());
    const endpoint = adapter.created[0];
    const inbound = index.acquireInbound(target.canonicalId, endpoint);
    expect(inbound.endpoint).toBe(endpoint); inbound.assertActive();
    expect(adapter.acquireInbound(target.canonicalId, endpoint).release()).toBeUndefined();
    expect(() => index.acquireInbound(target.canonicalId, undefined)).toThrow(/incarnation/);
    expect(() => index.acquireInbound(target.canonicalId, new NativeClient())).toThrow(/incarnation/);
    expect(() => index.acquire(target.canonicalId)).toThrow(/active/);
    await expect(inbound.send({ conversation: { endpoint: { id: target.canonicalId, adapter: 'native' }, kind: 'private', id: 'user' }, payload: 'pending' }))
      .rejects.toMatchObject({ code: 'endpoint_inactive', disposition: 'not_sent' });
    expect(endpoint.sent).not.toHaveBeenCalled();
    await expect(index.management(target.canonicalId)!.listGroups!()).rejects.toMatchObject({ code: 'endpoint_inactive' });
    expect(endpoint.listed).not.toHaveBeenCalled();
    const caller = new AbortController();
    const cancelled = index.acquireInbound(target.canonicalId, endpoint, caller.signal);
    caller.abort(); expect(cancelled.signal.aborted).toBe(true); expect(() => cancelled.assertActive()).toThrow();
    cancelled.release(); cancelled.release();
    await adapter.stop(target.instanceId, adapter.revision, { waitForExecution: false });
    await vi.waitFor(() => expect(inbound.signal.aborted).toBe(true));
    expect(() => index.acquireInbound(target.canonicalId, endpoint)).toThrow(/active/);
    expect(endpoint.stopped).not.toHaveBeenCalled();
    inbound.release(); inbound.release();
    await vi.waitFor(() => expect(endpoint.stopped).toHaveBeenCalledOnce());
    ready.resolve();
    await adapter.start(target.instanceId, adapter.revision);
    expect(() => index.acquireInbound(target.canonicalId, endpoint)).toThrow(/incarnation/);
    const current = adapter.getEndpoint(target.instanceId)!;
    const next = index.acquireInbound(target.canonicalId, current); next.release();
    await index.stop();
  });

  it('supports another SDK shape whose native send signature conflicts with canonical send', async () => {
    const adapter = new SocketAdapter();
    await adapter.initialize({ descriptor: { id: adapterId, owner: rootPluginId(), name: 'socket', source: 'fixture', capabilities: ['outbound'] },
      repository: new Repository(), initial: [], bind(endpoint, record) {
        bindPlatformEndpoint(endpoint, { id: record.canonicalId, name: 'socket', use: () => ({ receive: async () => undefined }) } as never); return [];
      } }, new AbortController().signal);
    await adapter.activate(new AbortController().signal);
    adapter.open();
    const added = await adapter.add(null, { endpointId: 'socket', config: {} });
    const record = added.endpoints[0];
    await adapter.start(record.instanceId, adapter.revision);
    const endpoint = adapter.getEndpoint(record.instanceId)!;
    expectTypeOf(endpoint).toEqualTypeOf<SocketEndpoint>();
    expect(endpoint.send('native')).toBe(1);
    const lease = adapter.acquire(record.canonicalId);
    expect(await lease.send({ conversation: { endpoint: { id: record.canonicalId, adapter: 'socket' }, kind: 'private', id: 'user' }, payload: 'canonical' })).toBe('socket-message');
    expect(endpoint.writes).toEqual(['native', 'canonical']);
    lease.release(); await adapter.dispose();
  });

  it('does not create an Endpoint when close races a pending desired-state commit', async () => {
    const { adapter, repository } = await create();
    const record = await add(adapter, 'one');
    const commit = gate<void>(), entered = gate<void>();
    repository.compareAndSet.mockImplementationOnce(async (_id, revision, endpoints) => {
      entered.resolve(); await commit.promise;
      repository.state = { revision: revision! + 1, endpoints }; return repository.state;
    });
    const starting = adapter.start(record.instanceId, adapter.revision);
    await entered.promise;
    const closing = adapter.dispose(); commit.resolve();
    expect((await starting).execution).toEqual({ status: 'failed', code: 'adapter_closed' });
    await closing;
    expect(adapter.created).toHaveLength(0);
    expect(repository.state!.endpoints[0].desiredEnabled).toBe(true);
  });

  it('propagates repository read failures and preserves legacy canonical identities', async () => {
    const broken = new Repository(); broken.load.mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(create(broken)).rejects.toThrow('storage unavailable');
    expect(broken.compareAndSet).not.toHaveBeenCalled();
    const repository = new Repository();
    repository.state = { revision: 3, endpoints: [{ instanceId: 'legacy', canonicalId: adapterId,
      endpointId: 'old-name', revision: 1, desiredEnabled: true, config: {} }] };
    const { adapter } = await create(repository);
    await adapter.activate(new AbortController().signal);
    expect(adapter.list()[0].canonicalId).toBe(adapterId);
    expect(adapter.getEndpoint('legacy')).toBe(adapter.created[0]);
    await adapter.stop('legacy', adapter.revision);
    expect(repository.state.endpoints[0].canonicalId).toBe(adapterId);
    await adapter.dispose();
  });

  it.each(['restart', 'remove'] as const)('retains a failed retired epoch after %s without retrying SDK stop', async (operation) => {
    const { adapter } = await create();
    const record = await add(adapter, 'one');
    await adapter.start(record.instanceId, adapter.revision);
    const endpoint = adapter.getEndpoint(record.instanceId)!;
    endpoint.stopped.mockRejectedValueOnce(new Error('native cleanup failed'));
    if (operation === 'remove') {
      expect((await adapter.remove(record.instanceId, adapter.revision)).execution.status).toBe('failed');
    } else {
      expect((await adapter.stop(record.instanceId, adapter.revision)).execution.status).toBe('failed');
      expect((await adapter.start(record.instanceId, adapter.revision)).execution.status).toBe('failed');
      expect(adapter.created).toHaveLength(1);
    }
    await expect(adapter.dispose()).rejects.toBeInstanceOf(AggregateError);
    expect(endpoint.stopped).toHaveBeenCalledTimes(1);
  });

  it('waits for the same account to drain and close before a new start, while another account remains usable', async () => {
    const { adapter } = await create(); const one = await add(adapter, 'one'); const two = await add(adapter, 'two');
    await adapter.start(one.instanceId, adapter.revision); await adapter.start(two.instanceId, adapter.revision);
    const previous = adapter.getEndpoint(one.instanceId)!;
    const lease = adapter.acquire(one.canonicalId);
    const stopping = adapter.stop(one.instanceId, adapter.revision, { waitForExecution: false });
    await stopping;
    const starting = await adapter.start(one.instanceId, adapter.revision, { waitForExecution: false });
    expect(starting.execution.status).toBe('pending');
    await new Promise(resolve => setImmediate(resolve));
    expect(adapter.created).toHaveLength(2); expect(previous.stopped).not.toHaveBeenCalled();
    const other = adapter.acquire(two.canonicalId);
    expect(other.signal.aborted).toBe(false); other.release();
    lease.release();
    await vi.waitFor(() => expect(adapter.lastMutation?.status).toBe('applied'));
    expect(previous.stopped).toHaveBeenCalledOnce(); expect(adapter.created).toHaveLength(3);
    expect(adapter.getEndpoint(one.instanceId)).not.toBe(previous);
    await adapter.dispose();
  });

  it('retains a cleanup failure without repeating the destructive SDK call', async () => {
    const { adapter } = await create(); const record = await add(adapter, 'one');
    await adapter.start(record.instanceId, adapter.revision);
    const endpoint = adapter.getEndpoint(record.instanceId)!;
    endpoint.stopped.mockRejectedValueOnce(new Error('native cleanup failed'));
    expect((await adapter.stop(record.instanceId, adapter.revision)).execution.status).toBe('failed');
    expect(adapter.list()[0].desiredEnabled).toBe(false);
    await expect(adapter.dispose()).rejects.toBeInstanceOf(AggregateError);
    expect(endpoint.stopped).toHaveBeenCalledTimes(1);
  });

  it('acknowledges a committed start before login finishes and exposes its eventual result', async () => {
    const { adapter } = await create(); const record = await add(adapter, 'one');
    const ready = gate<void>();
    adapter.connect = endpoint => { endpoint.connected.mockImplementation(() => ready.promise); };
    const beforeCommit = vi.fn();
    const accepted = await adapter.start(record.instanceId, adapter.revision, { waitForExecution: false, beforeCommit });
    expect(beforeCommit).toHaveBeenCalledTimes(1);
    expect(accepted.execution.status).toBe('pending');
    expect(adapter.lastMutation).toMatchObject({ instanceId: record.instanceId, action: 'start', status: 'pending' });
    ready.resolve();
    await vi.waitFor(() => expect(adapter.lastMutation?.status).toBe('applied'));
    await adapter.dispose();
  });

  it('replaces identity in one CAS, preserves siblings and saves the replacement disabled', async () => {
    const { adapter, repository } = await create();
    const one = await add(adapter, 'one'), two = await add(adapter, 'two');
    await adapter.start(one.instanceId, adapter.revision); await adapter.start(two.instanceId, adapter.revision);
    const previous = adapter.getEndpoint(one.instanceId)!;
    const sibling = adapter.getEndpoint(two.instanceId)!;
    const calls = repository.compareAndSet.mock.calls.length;
    const replacement = await adapter.replace(one.instanceId, adapter.revision, { endpointId: 'new', config: { name: 'new' } });
    expect(repository.compareAndSet.mock.calls.length).toBe(calls + 1);
    const next = replacement.endpoints.find(entry => entry.endpointId === 'new')!;
    expect(next.instanceId).not.toBe(one.instanceId); expect(next.canonicalId).not.toBe(one.canonicalId);
    expect(next.desiredEnabled).toBe(false); expect(adapter.getEndpoint(next.instanceId)).toBeUndefined();
    expect(previous.stopped).toHaveBeenCalledTimes(1); expect(adapter.getEndpoint(two.instanceId)).toBe(sibling);
    await adapter.dispose();
  });

});

class VerifiedAdapter extends NativeAdapter {
  override get configurationIdentityProbeFields() { return ['token', 'remote.url']; }
  override get configurationUpdateFields() { return ['token', 'remote.url', 'reconnectDelay']; }
  readonly identify = vi.fn(async (config: Record<string, unknown>, signal: AbortSignal, fields: readonly string[]): Promise<string | undefined> => {
    signal.throwIfAborted();
    void fields;
    if (config.token === 'failed') throw new Error('identity verification failed');
    if (config.token === 'unsupported') return undefined;
    return config.token === 'other' ? 'platform:other' : 'platform:original';
  });
  protected override identifyConfiguration(config: Record<string, unknown>, signal: AbortSignal, fields: readonly string[]) {
    return this.identify(config, signal, fields);
  }
  protected override prepareConfiguration(config: Record<string, unknown>, identity: {instanceId: string}) {
    return { ...config, resourceDirectory: identity.instanceId };
  }
}
describe('verified account identity at the desired-state boundary', () => {
  async function fixture() {
    const adapter = new VerifiedAdapter(); const result = await create(new Repository(), adapter);
    const saved = await adapter.add(adapter.revision, { endpointId: 'one', config: { token: 'original', remote: { url: 'https://one.example' } } });
    return { ...result, adapter, target: saved.endpoints[0] };
  }
  it('prepares a new resource namespace before persistence without constructing a Client', async () => {
    const { adapter, repository, target } = await fixture();
    expect(repository.state?.endpoints[0].config.resourceDirectory).toBe(target.instanceId);
    expect(adapter.created).toHaveLength(0); expect(adapter.identify).not.toHaveBeenCalled();
    await adapter.dispose();
  });
  it('verifies rotated credentials, retains identity, and reconnects only the current account', async () => {
    const { adapter, target } = await fixture(); await adapter.start(target.instanceId, adapter.revision);
    const original = adapter.getEndpoint(target.instanceId)!;
    const result = await adapter.patchConfiguration(target.instanceId, adapter.revision, { token: 'rotated' });
    expect(result.endpoints[0].instanceId).toBe(target.instanceId);
    expect(adapter.getEndpoint(target.instanceId)).not.toBe(original);
    expect(adapter.identify.mock.calls.map(call => [call[0].token, call[2]])).toEqual([['original', ['token']], ['rotated', ['token']]]);
    expect(original.stopped).toHaveBeenCalledOnce(); await adapter.dispose();
  });
  it('replaces verified different accounts atomically, disabled with a new resource namespace', async () => {
    const { adapter, repository, target } = await fixture(); await adapter.start(target.instanceId, adapter.revision);
    const original = adapter.getEndpoint(target.instanceId)!;
    const result = await adapter.patchConfiguration(target.instanceId, adapter.revision, { token: 'other' });
    expect(result.endpoints[0].instanceId).not.toBe(target.instanceId);
    expect(result.endpoints[0].desiredEnabled).toBe(false);
    expect(repository.state?.endpoints[0].config.resourceDirectory).toBe(result.endpoints[0].instanceId);
    expect(adapter.created).toHaveLength(1); expect(original.stopped).toHaveBeenCalledOnce(); await adapter.dispose();
  });
  it.each(['failed','unsupported'])('does not save or reconnect when identity is %s', async token => {
    const { adapter, repository, target } = await fixture(); await adapter.start(target.instanceId, adapter.revision);
    const original = adapter.getEndpoint(target.instanceId), revision = adapter.revision;
    const writes = repository.compareAndSet.mock.calls.length;
    await expect(adapter.patchConfiguration(target.instanceId, revision, { token })).rejects.toThrow();
    expect(repository.compareAndSet).toHaveBeenCalledTimes(writes); expect(adapter.revision).toBe(revision);
    expect(adapter.getEndpoint(target.instanceId)).toBe(original); await adapter.dispose();
  });
  it('checks nested identity-bearing targets but does not probe ordinary connection fields', async () => {
    const { adapter, target } = await fixture();
    await adapter.update(target.instanceId, adapter.revision, { config: { token: 'original', remote: { url: 'https://two.example' } } });
    expect(adapter.identify).toHaveBeenCalledTimes(2); expect(adapter.identify.mock.calls[0][2]).toEqual(['remote.url']);
    adapter.identify.mockClear();
    await adapter.update(target.instanceId, adapter.revision, { config: { token: 'original', remote: { url: 'https://two.example' }, reconnectDelay: 1000 } });
    expect(adapter.identify).not.toHaveBeenCalled(); await adapter.dispose();
  });
  it('rejects a verified result made stale by an intervening stop', async () => {
    const { adapter, repository, target } = await fixture(); const pending = gate<string>();
    adapter.identify.mockImplementationOnce(() => pending.promise);
    const revision = adapter.revision;
    const updating = adapter.update(target.instanceId, revision, { config: { token: 'rotated', remote: { url: 'https://one.example' } } });
    await vi.waitFor(() => expect(adapter.identify).toHaveBeenCalledOnce());
    await adapter.stop(target.instanceId, revision); const writes = repository.compareAndSet.mock.calls.length;
    pending.resolve('platform:original'); await expect(updating).rejects.toMatchObject({ code: 'conflict' });
    expect(repository.compareAndSet).toHaveBeenCalledTimes(writes); await adapter.dispose();
  });
  it('cancels verification when the owning Adapter is disposed', async () => {
    const { adapter, target } = await fixture(); const pending = gate<string>();
    adapter.identify.mockImplementationOnce(async (_config, signal) => { await pending.promise; signal.throwIfAborted(); return 'platform:original'; });
    const updating = adapter.update(target.instanceId, adapter.revision, { config: { token: 'rotated' } });
    await vi.waitFor(() => expect(adapter.identify).toHaveBeenCalledOnce());
    const signal = adapter.identify.mock.calls[0][1]; await adapter.dispose(); expect(signal.aborted).toBe(true);
    pending.resolve('platform:original'); await expect(updating).rejects.toThrow();
  });

  it('persists the exact configuration whose identity was probed despite caller mutation during verification', async () => {
    const { adapter, repository, target } = await fixture();
    const entered = gate<void>(), resume = gate<void>();
    adapter.identify.mockImplementationOnce(async () => 'platform:original');
    adapter.identify.mockImplementationOnce(async () => { entered.resolve(); await resume.promise; return 'platform:original'; });
    const config = { token: 'rotated', remote: { url: 'https://one.example' } };
    const updating = adapter.update(target.instanceId, adapter.revision, { config });
    await entered.promise;
    config.token = 'other'; config.remote.url = 'https://unverified.example';
    resume.resolve();
    try {
      await updating;
      expect(adapter.identify.mock.calls.map(call => call[0].token)).toEqual(['original', 'rotated']);
      expect(repository.state?.endpoints[0].config).toMatchObject({ token: 'rotated', remote: { url: 'https://one.example' } });
      expect(adapter.list()[0].instanceId).toBe(target.instanceId);
      expect(adapter.created).toHaveLength(0);
    } finally { resume.resolve(); await updating.catch(() => undefined); await adapter.dispose(); }
  });
  it('rejects a direct caller cancellation before its queued CAS without saving desired state', async () => {
    const { adapter, repository } = await fixture(), controller = new AbortController();
    const beforeCommit = vi.fn();
    const writes = repository.compareAndSet.mock.calls.length, reason = new Error('synthetic caller cancelled');
    const saving = adapter.add(adapter.revision, { endpointId: 'two', config: { token: 'rotated' } }, { signal: controller.signal, beforeCommit });
    controller.abort(reason);
    try {
      await expect(saving).rejects.toBe(reason);
      expect(beforeCommit).not.toHaveBeenCalled();
      expect(repository.compareAndSet).toHaveBeenCalledTimes(writes);
      expect(adapter.list().map(record => record.endpointId)).toEqual(['one']);
      expect(adapter.created).toHaveLength(0);
    } finally { await saving.catch(() => undefined); await adapter.dispose(); }
  });
  it('rejects a queued CAS when its owning Adapter is disposed in the same tick', async () => {
    const { adapter, repository } = await fixture(), writes = repository.compareAndSet.mock.calls.length;
    const beforeCommit = vi.fn();
    const saving = adapter.add(adapter.revision, { endpointId: 'two', config: { token: 'rotated' } }, { beforeCommit });
    const observed = saving.catch(error => error), disposing = adapter.dispose();
    try {
      expect(await observed).toMatchObject({ code: 'closed' });
      expect(beforeCommit).not.toHaveBeenCalled();
      await disposing;
      expect(repository.compareAndSet).toHaveBeenCalledTimes(writes);
      expect(repository.state?.endpoints.map(record => record.endpointId)).toEqual(['one']);
      expect(adapter.created).toHaveLength(0);
    } finally { await observed; await disposing; }
  });
  it('owns an immutable secret reference snapshot before the add CAS is queued', async () => {
    const { adapter, repository } = await fixture(), secretRefs = { token: 'synthetic-reference-before' };
    const saving = adapter.add(adapter.revision, { endpointId: 'two', config: { token: 'placeholder' }, secretRefs });
    secretRefs.token = 'synthetic-reference-after';
    try {
      await saving;
      expect(repository.state?.endpoints.find(record => record.endpointId === 'two')?.secretRefs).toEqual({ token: 'synthetic-reference-before' });
      expect(adapter.list().find(record => record.endpointId === 'two')?.desiredEnabled).toBe(false);
      expect(adapter.created).toHaveLength(0);
    } finally { await saving.catch(() => undefined); await adapter.dispose(); }
  });

});

class LoginAdapter extends NativeAdapter {
  readonly contexts: EndpointCreationContext[] = [];
  protected override createEndpoint(config: Record<string, unknown>, context: EndpointCreationContext): NativeEndpoint {
    this.contexts.push(context); return super.createEndpoint(config, context);
  }
  saveLogin(context: EndpointCreationContext, userId: string, config: Record<string, unknown>, previousIdentity: EndpointPreviousIdentity = { kind: 'unbound' }) {
    return this.acceptVerifiedLogin(context, { userId, config, previousIdentity });
  }
}
describe('verified login completion belongs to the exact account incarnation', () => {
  async function fixture() {
    const adapter = new LoginAdapter(), repository = new Repository(); await create(repository, adapter);
    const target = await add(adapter, 'login'); await adapter.start(target.instanceId, adapter.revision);
    return { adapter, repository, target, endpoint: adapter.getEndpoint(target.instanceId)!, context: adapter.contexts[0] };
  }
  it('persists a first verified identity and credentials without restarting the active login Client', async () => {
    const { adapter, repository, target, endpoint, context } = await fixture();
    await expect(adapter.saveLogin(context, 'first-user', { token: 'verified-fixture' })).resolves.toBe('retained');
    expect(adapter.getEndpoint(target.instanceId)).toBe(endpoint); expect(endpoint.stopped).not.toHaveBeenCalled();
    expect(repository.state?.endpoints[0]).toMatchObject({ instanceId: target.instanceId, platformUserId: 'first-user', config: { token: 'verified-fixture' } });
    expect(adapter.list()[0]).not.toHaveProperty('platformUserId'); await adapter.dispose();
  });
  it('replaces a different verified login with a fresh disabled identity', async () => {
    const { adapter, repository, target, endpoint, context } = await fixture();
    endpoint[endpointSpec].reportSelfUserId('previous-user');
    await expect(adapter.saveLogin(context, 'different-user', { token: 'other-fixture' })).resolves.toBe('replaced');
    const next = adapter.list()[0]; expect(next.instanceId).not.toBe(target.instanceId); expect(next.desiredEnabled).toBe(false);
    expect(repository.state?.endpoints[0].config).toMatchObject({ token: 'other-fixture' });
    expect(adapter.created).toHaveLength(1); await vi.waitFor(() => expect(endpoint.stopped).toHaveBeenCalledOnce());
    await adapter.dispose();
  });
  it('keeps a persisted identity binding after logout and process restoration', async () => {
    const { adapter, repository, context } = await fixture();
    await adapter.saveLogin(context, 'previous-user', { token: 'old-fixture' }); await adapter.dispose();
    const restored = new LoginAdapter(); await create(repository, restored);
    const saved = restored.list()[0]; await restored.start(saved.instanceId, restored.revision);
    await expect(restored.saveLogin(restored.contexts[0], 'different-user', { token: 'other-fixture' })).resolves.toBe('replaced');
    expect(restored.list()[0].instanceId).not.toBe(saved.instanceId); await restored.dispose();
  });
  it('does not save a late login from an old execution or an old restored incarnation', async () => {
    const { adapter, repository, target, context } = await fixture();
    await adapter.stop(target.instanceId, adapter.revision); await adapter.start(target.instanceId, adapter.revision);
    const writes = repository.compareAndSet.mock.calls.length;
    await expect(adapter.saveLogin(context, 'late-user', { token: 'late-fixture' })).rejects.toMatchObject({ code: 'inactive' });
    const current = adapter.contexts.at(-1)!;
    await expect(adapter.saveLogin({ ...current, incarnationId: 'stale-incarnation' }, 'late-user', {})).rejects.toMatchObject({ code: 'inactive' });
    expect(repository.compareAndSet).toHaveBeenCalledTimes(writes); await adapter.dispose();
  });
  it('does not treat an unknown previous login as a first binding', async () => {
    const { adapter, repository, context, endpoint } = await fixture();
    const writes = repository.compareAndSet.mock.calls.length;
    await expect(adapter.saveLogin(context, 'verified-new', { token: 'new-fixture' }, { kind: 'unknown' }))
      .rejects.toMatchObject({ code: 'unsupported' });
    expect(repository.compareAndSet).toHaveBeenCalledTimes(writes); expect(endpoint.stopped).not.toHaveBeenCalled(); await adapter.dispose();
  });
  it('does not mutate the live Client or saved record if persistence fails', async () => {
    const { adapter, repository, target, context, endpoint } = await fixture(), revision = adapter.revision;
    repository.compareAndSet.mockRejectedValueOnce(new AdapterManagementError('conflict', 'concurrent change'));
    await expect(adapter.saveLogin(context, 'verified-user', { token: 'new-fixture' })).rejects.toMatchObject({ code: 'conflict' });
    expect(adapter.revision).toBe(revision); expect(adapter.getEndpoint(target.instanceId)).toBe(endpoint);
    expect(repository.state?.endpoints[0].config.token).toBeUndefined(); expect(endpoint.stopped).not.toHaveBeenCalled(); await adapter.dispose();
  });
});
