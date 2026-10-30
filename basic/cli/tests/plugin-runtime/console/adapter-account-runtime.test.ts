import { afterEach, describe, expect, it, vi } from 'vitest';
import { unrestrictedConsoleAccess, type ConsoleAccess } from '@zhin.js/host-http';
import { Adapter, AdapterIndex, AdapterManagementError, adapterFeatureId, createAdapterConsoleRpc,
  createEndpointSpecification, defineAdapter, endpointConfigurationStoreToken, endpointEventGatewayToken,
  createEndpointCommands,
  endpointSpec, type EndpointDesiredRepository, type EndpointDesiredSnapshot, type EndpointDesiredRecord,
  type PlatformEndpoint } from '@zhin.js/adapter';
import { SnapshotStore, childPluginId, createCapabilitySlot, featureId, pluginConsoleRpcToken, rootPluginId,
  type CapabilityId, type PluginConsoleRpcCall, type SnapshotState, type TokenId } from '@zhin.js/plugin-runtime';
import { dispatchPluginConsoleRpcRequest } from '../../../src/plugin-runtime/console/plugin-console-rpc.js';
import { CommandIndex, commandFeatureId, defineCommand } from '@zhin.js/command';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDatabaseHost } from '../../../src/plugin-runtime/database-host-installer.js';
import { PersistentEndpointRepository } from '../../../src/plugin-runtime/runtime-endpoints/state.js';

const root = rootPluginId(), owner = childPluginId(root, 'first'), other = childPluginId(root, 'second');
const scoped: ConsoleAccess = { unrestricted: false, permissions: ['account:read', 'account:write'], roles: [] };
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }

class Repository implements EndpointDesiredRepository {
  readonly state = new Map<CapabilityId, EndpointDesiredSnapshot>();
  gate?: Promise<void>;
  load = vi.fn(async (id: CapabilityId) => this.state.get(id));
  compareAndSet = vi.fn(async (id: CapabilityId, revision: number | null, endpoints: readonly EndpointDesiredRecord[], commitId?: string) => {
    if ((this.state.get(id)?.revision ?? null) !== revision) throw new AdapterManagementError('conflict', 'conflict');
    if (this.gate) await this.gate;
    const next = structuredClone({ revision: (revision ?? 0) + 1, endpoints, ...(commitId ? { commitId } : {}) }); this.state.set(id, next); return next;
  });
}
class ClientEndpoint implements PlatformEndpoint {
  readonly [endpointSpec];
  readonly stopped = vi.fn(async () => undefined);
  constructor(readiness: Promise<void>) {
    this[endpointSpec] = createEndpointSpecification(this, {
      start: () => readiness, open: () => undefined, close: () => undefined, stop: () => this.stopped(),
      send: async () => 'message-id',
    });
  }
}
class AccountAdapter extends Adapter<ClientEndpoint> {
  readonly created: ClientEndpoint[] = [];
  readiness = Promise.resolve();
  override get configurationIdentityFields(): readonly string[] { return ['id']; }
  override get configurationUpdateFields(): readonly string[] { return ['password', 'label']; }
  protected createEndpoint(): ClientEndpoint { const endpoint = new ClientEndpoint(this.readiness); this.created.push(endpoint); return endpoint; }
}

async function fixture(extra: Readonly<Record<string, unknown>> = {}) {
  const repository = new Repository();
  const adapters = new Map([[owner, new AccountAdapter()], [other, new AccountAdapter()]]);
  const legacy = { list: vi.fn(async () => { throw new Error('legacy file read'); }),
    add: vi.fn(async () => { throw new Error('legacy file write'); }), remove: vi.fn(async () => { throw new Error('legacy file write'); }) };
  const spec = { adapterKey: 'account', adapterDisplayName: 'Account', readPermission: 'account:read', writePermission: 'account:write',
    fields: [{ key: 'password', required: true, env: true }, { key: 'label' }] };
  const rpcs = new Map([owner, other].map(id => [id, createAdapterConsoleRpc(spec, {
    has: token => token.id === endpointConfigurationStoreToken.id,
    use: () => legacy as never,
  })]));
  const slots = [...adapters].map(([id, adapter]) => createCapabilitySlot({ owner: id, feature: adapterFeatureId,
    localName: 'account', source: 'fixture', definition: defineAdapter({ capabilities: ['inbound', 'outbound'], createAdapter: () => adapter }) }));
  const state: SnapshotState = { root,
    tree: new Map([[root, { id: root, instanceKey: 'root', packageName: 'fixture', packageRoot: '/fixture', children: [owner, other] }],
      ...[owner, other].map(id => [id, { id, parent: root, instanceKey: String(id), packageName: 'fixture', packageRoot: '/fixture', children: [] }] as const)]),
    config: new Map([owner, other].map(id => [id, { id: id === owner ? 'legacy-a' : 'legacy-b', password: `secret-${id}`, label: 'before', master: 'deployment-only', ...extra }])),
    resources: new Map([owner, other].map(id => [id, new Map<TokenId, unknown>([
      [endpointEventGatewayToken.id, { receive: async () => undefined }], [pluginConsoleRpcToken.id, rpcs.get(id)],
    ])])), capabilities: new Map(slots.map(slot => [slot.id, slot])), projections: new Map(),
  };
  const index = await AdapterIndex.create(slots, { ...state, generation: 0 }, new AbortController().signal, { repository });
  await index.activate(new AbortController().signal);
  const store = new SnapshotStore({ ...state, projections: new Map([[adapterFeatureId, index]]) });
  cleanup.push(async () => { await index.stop(); await store.close(); });
  const call = (action: string, data: Record<string, unknown> = {}, access = unrestrictedConsoleAccess, id = owner, timeoutMs?: number) =>
    dispatchPluginConsoleRpcRequest({ type: `plugin.${id}.${action}`, data }, { snapshots: store, access,
      pagesOwnedBy: () => [{ localName: 'index', requiredPermissions: ['account:read'], requiredRoles: [] }] as never,
      ...(timeoutMs === undefined ? {} : { timeoutMs }) });
  return { repository, adapters, index, store, state, legacy, call, rpcs, slots };
}

describe('authenticated owner-scoped Adapter account RPC', () => {
  it('projects only owned metadata, masks secrets and never reads the legacy file store', async () => {
    const f = await fixture();
    const reply = await f.call('status');
    expect(reply).toMatchObject({ status: 200, body: { data: { runtime: { generation: 0, revision: null, needsMigration: true, canMigrate: true },
      configured: [{ id: 'legacy-a', instanceId: expect.any(String), values: { password: '••••••', label: 'before' } }] } } });
    expect(JSON.stringify(reply)).not.toContain('secret-'); expect(JSON.stringify(reply)).not.toContain('deployment-only');
    expect(JSON.stringify(reply)).not.toContain('legacy-b'); expect(f.legacy.list).not.toHaveBeenCalled();
    const legacy = f.adapters.get(owner)!.list()[0];
    expect(legacy.endpointId).toBe('legacy-a');
    expect(legacy.instanceId).toBe(f.adapters.get(owner)!.descriptor.id);
    expect(legacy.canonicalId).toBe(f.adapters.get(owner)!.descriptor.id);
    expect(f.index.resolve('account', 'account')).toBe(legacy.canonicalId);
    expect(f.index.resolve('account', 'legacy-a')).toBe(legacy.canonicalId);
    const directory = f.index.forOwner(owner);
    expect(directory.adapters()).toEqual([f.adapters.get(owner)]);
    expect(directory.adapter(f.adapters.get(other)!.descriptor.id)).toBeUndefined();
  });

  it('requires admin migration confirmation before a first CAS, then permits existing write delegation', async () => {
    const f = await fixture();
    const input = { expectedGeneration: 0, expectedRevision: null, id: 'new', values: { password: 'new-secret' } };
    expect(await f.call('endpoint-add', input)).toMatchObject({ body: { code: 'conflict' } });
    expect(await f.call('endpoint-add', { ...input, confirmMigration: true }, scoped)).toMatchObject({ status: 403, body: { code: 'forbidden' } });
    expect(f.repository.compareAndSet).not.toHaveBeenCalled();
    const adapter = f.adapters.get(owner)!; const legacyId = adapter.list()[0].canonicalId;
    const count = adapter.created.length;
    expect(await f.call('endpoint-add', { ...input, confirmMigration: true })).toMatchObject({ status: 200, body: { data: { saved: true, restartRequired: false } } });
    expect(adapter.created).toHaveLength(count);
    expect(adapter.list()[0].canonicalId).toBe(legacyId);
    expect(await f.call('endpoint-add', { ...input, expectedRevision: adapter.revision, id: 'delegated' }, scoped)).toMatchObject({ status: 200 });
    expect(f.store.current.generation).toBe(0);
    expect(f.state.config.get(owner)).toMatchObject({ id: 'legacy-a', label: 'before' });
    expect(f.legacy.add).not.toHaveBeenCalled(); expect(f.legacy.remove).not.toHaveBeenCalled();
  });

  it('preserves untouched secrets on patch, rejects identity/policy edits, and replaces with one disabled new identity', async () => {
    const f = await fixture(); const adapter = f.adapters.get(owner)!; const previous = adapter.list()[0];
    const input = { expectedGeneration: 0, expectedRevision: null, confirmMigration: true, instanceId: previous.instanceId };
    expect(await f.call('endpoint-update', { ...input, values: { label: 'after', password: '' } })).toMatchObject({ status: 200, body: { data: { saved: true } } });
    const stored = f.repository.state.get(adapter.descriptor.id)!;
    expect(stored.endpoints[0].config.password).toBe(`secret-${owner}`);
    await vi.waitFor(() => expect(adapter.lastMutation?.status).toBe('applied'));
    const revision = adapter.revision;
    expect(await f.call('endpoint-update', { ...input, expectedRevision: revision, values: { id: 'switched' } })).toMatchObject({ status: 400 });
    expect(await f.call('endpoint-update', { ...input, expectedRevision: revision, values: { master: 'evil' } })).toMatchObject({ status: 400 });
    const writes = f.repository.compareAndSet.mock.calls.length;
    const reply = await f.call('endpoint-replace', { ...input, expectedRevision: revision, id: 'replacement', values: { password: 'fresh' } });
    expect(reply).toMatchObject({ status: 200, body: { data: { saved: true, restartRequired: false } } });
    expect(f.repository.compareAndSet.mock.calls.length).toBe(writes + 1);
    const next = adapter.list()[0]; expect(next.instanceId).not.toBe(previous.instanceId); expect(next.canonicalId).not.toBe(previous.canonicalId);
    expect(next.desiredEnabled).toBe(false); expect(adapter.getEndpoint(next.instanceId)).toBeUndefined();
  });

  it('rejects stale generation/revision and cross-owner target ids without writes', async () => {
    const f = await fixture(); const adapter = f.adapters.get(owner)!; const target = f.adapters.get(other)!.list()[0];
    const data = { expectedGeneration: 0, expectedRevision: null, confirmMigration: true, instanceId: target.instanceId };
    expect(await f.call('endpoint-stop', data)).toMatchObject({ status: 404 });
    expect(await f.call('endpoint-add', { ...data, expectedGeneration: 1, id: 'x', values: { password: 'x' } })).toMatchObject({ status: 409 });
    expect(await f.call('endpoint-add', { ...data, expectedRevision: 99, id: 'x', values: { password: 'x' } })).toMatchObject({ status: 409 });
    expect(f.repository.compareAndSet).not.toHaveBeenCalled(); expect(adapter.list()[0].desiredEnabled).toBe(true);
    const denied: ConsoleAccess = { unrestricted: false, permissions: ['account:read'], roles: [] };
    expect(await f.call('endpoint-stop', { ...data, instanceId: adapter.list()[0].instanceId }, denied)).toMatchObject({ status: 403 });
  });

  it('acknowledges long readiness and reports CAS timeout as unknown without retry', async () => {
    const f = await fixture(); const adapter = f.adapters.get(owner)!;
    await f.call('endpoint-add', { expectedGeneration: 0, expectedRevision: null, confirmMigration: true, id: 'slow', values: { password: 'secret' } });
    const record = adapter.list().find(entry => entry.endpointId === 'slow')!;
    const ready = deferred(); adapter.readiness = ready.promise;
    const started = await f.call('endpoint-start', { expectedGeneration: 0, expectedRevision: adapter.revision, instanceId: record.instanceId }, unrestrictedConsoleAccess, owner, 30);
    expect(started).toMatchObject({ status: 200, body: { data: { saved: true, execution: { status: 'pending' } } } });
    expect((await f.call('status'))?.body).toMatchObject({ data: { runtime: { lastMutation: { instanceId: record.instanceId, status: 'pending' } } } });
    ready.resolve(); await vi.waitFor(() => expect(adapter.lastMutation?.status).toBe('applied'));
    const commit = deferred(); f.repository.gate = commit.promise;
    const calls = f.repository.compareAndSet.mock.calls.length;
    const unknown = await f.call('endpoint-stop', { expectedGeneration: 0, expectedRevision: adapter.revision, instanceId: record.instanceId }, unrestrictedConsoleAccess, owner, 20);
    expect(unknown).toMatchObject({ status: 504, body: { code: 'commit_unknown' } });
    expect(f.repository.compareAndSet.mock.calls.length).toBe(calls + 1);
    expect(await f.call('status')).toMatchObject({ status: 504, body: { code: 'commit_unknown' } });
    f.repository.gate = undefined; commit.resolve();
    await vi.waitFor(() => expect(adapter.list().find(entry => entry.instanceId === record.instanceId)?.desiredEnabled).toBe(false));
  });

  it('routes actual CommandIndex add/remove to the same owned Adapter without files, bind flow, or Root rebuild', async () => {
    const f = await fixture(); const adapter = f.adapters.get(owner)!;
    const bindFlow = vi.fn(async () => 'legacy interactive binding');
    const definitions = createEndpointCommands({ adapterKey: 'account', adapterDisplayName: 'Account',
      fields: [{ key: 'password', required: true, env: true }], bindFlow }, defineCommand);
    const slots = (['list', 'add', 'remove'] as const).map(action => createCapabilitySlot({ owner, feature: commandFeatureId,
      localName: `account/endpoint/${action}${action === 'list' ? '' : '/$id'}`, source: 'fixture',
      definition: action === 'list' ? definitions[action] : { ...definitions[action], $parameter: { name: 'id', type: 'string' } } }));
    const projections = new Map(f.store.current.projections);
    const snapshot = { ...f.store.current, projections, capabilities: new Map([...f.store.current.capabilities, ...slots.map(slot => [slot.id, slot] as const)]) };
    const commands = new CommandIndex(slots, snapshot); projections.set(commandFeatureId, commands);
    const source = { sender: { id: 'deployment-only' } };
    const before = await commands.dispatch('account endpoint add fresh password=secret', source);
    expect(before).toMatchObject({ status: 'executed', value: expect.stringContaining('Console') });
    expect(f.repository.compareAndSet).not.toHaveBeenCalled();
    await f.call('endpoint-add', { expectedGeneration: 0, expectedRevision: null, confirmMigration: true, id: 'migrated', values: { password: 'admin' } });
    const created = adapter.created.length, generation = f.store.current.generation, pid = process.pid;
    expect(await commands.dispatch('account endpoint add fresh password=secret', source)).toMatchObject({ status: 'executed', value: expect.stringContaining('尚未启动') });
    expect(adapter.created).toHaveLength(created); expect(bindFlow).not.toHaveBeenCalled();
    const record = adapter.list().find(entry => entry.endpointId === 'fresh')!;
    await adapter.start(record.instanceId, adapter.revision);
    const endpoint = adapter.getEndpoint(record.instanceId)!;
    const lease = adapter.acquire(record.canonicalId);
    try {
      expect(await commands.dispatch('account endpoint remove fresh', source)).toMatchObject({ status: 'executed', value: expect.stringContaining('正在取消') });
      expect(lease.signal.aborted).toBe(true); expect(endpoint.stopped).not.toHaveBeenCalled();
    } finally { lease.release(); }
    await vi.waitFor(() => expect(endpoint.stopped).toHaveBeenCalledTimes(1));
    expect(f.legacy.add).not.toHaveBeenCalled(); expect(f.legacy.remove).not.toHaveBeenCalled();
    expect(f.store.current.generation).toBe(generation); expect(process.pid).toBe(pid);
    const faulty = new CommandIndex(slots, { ...snapshot, projections: new Map() });
    await expect(faulty.dispatch('account endpoint add denied password=secret', source)).rejects.toThrow('projection');
    expect(f.legacy.add).not.toHaveBeenCalled();
  });

  it('verifies an unknown SQLite commit before status succeeds and resumes its unexecuted start once', async () => {
    const f = await fixture({ optional: undefined }); const adapter = f.adapters.get(owner)!;
    const directory = await mkdtemp(join(tmpdir(), 'zhin-account-recovery-'));
    const database = createDatabaseHost({ dialect: 'sqlite', filename: join(directory, 'state.sqlite') });
    await database.start();
    cleanup.push(async () => { await database.stop(); await rm(directory, { recursive: true, force: true }); });
    let loseResponse = false, failRead = false;
    const compareExchange = vi.fn(async (...args: Parameters<typeof database.state.compareExchange>) => {
      const written = await database.state.compareExchange(...args);
      if (written && loseResponse) { loseResponse = false; failRead = true; throw new Error('response lost after commit'); }
      return written;
    });
    const persisted = new PersistentEndpointRepository({ rootId: '/fixture', directory: join(directory, 'private'), state: () => ({
      read: async (...args) => { if (failRead) { failRead = false; throw new Error('read unavailable'); } return database.state.read(...args); },
      compareExchange,
    }) });
    f.repository.load.mockImplementation(id => persisted.load(id));
    f.repository.compareAndSet.mockImplementation((...args) => persisted.compareAndSet(...args));
    await f.call('endpoint-add', { expectedGeneration: 0, expectedRevision: null, confirmMigration: true, id: 'uncertain', values: { password: 'synthetic' } });
    const target = adapter.list().find(record => record.endpointId === 'uncertain')!;
    const count = adapter.created.length;
    loseResponse = true;
    expect(await f.call('endpoint-start', { expectedGeneration: 0, expectedRevision: 1, instanceId: target.instanceId }))
      .toMatchObject({ status: 504, body: { code: 'commit_unknown' } });
    expect(adapter.created).toHaveLength(count);
    expect(await f.call('status')).toMatchObject({ status: 504, body: { code: 'commit_unknown' } });
    expect(adapter.created).toHaveLength(count);
    expect(await f.call('status')).toMatchObject({ status: 200, body: { data: { runtime: { revision: 2 } } } });
    await vi.waitFor(() => expect(adapter.lastMutation).toMatchObject({ action: 'start', status: 'applied' }));
    expect(adapter.created).toHaveLength(count + 1);
    expect(compareExchange).toHaveBeenCalledTimes(2);
    await f.call('status'); expect(adapter.created).toHaveLength(count + 1);
    const endpoint = adapter.getEndpoint(target.instanceId)!;
    loseResponse = true;
    expect(await f.call('endpoint-remove', { expectedGeneration: 0, expectedRevision: 2, instanceId: target.instanceId }))
      .toMatchObject({ status: 504, body: { code: 'commit_unknown' } });
    expect(endpoint.stopped).not.toHaveBeenCalled();
    expect(await f.call('status')).toMatchObject({ status: 504, body: { code: 'commit_unknown' } });
    expect(await f.call('status')).toMatchObject({ status: 200, body: { data: { runtime: { revision: 3 } } } });
    await vi.waitFor(() => expect(endpoint.stopped).toHaveBeenCalledOnce());
    await f.call('status'); expect(endpoint.stopped).toHaveBeenCalledOnce();
    expect(compareExchange).toHaveBeenCalledTimes(3);
    await f.call('endpoint-add', { expectedGeneration: 0, expectedRevision: 3, id: 'external', values: { password: 'synthetic' } });
    const external = adapter.list().find(record => record.endpointId === 'external')!;
    loseResponse = true;
    expect(await f.call('endpoint-start', { expectedGeneration: 0, expectedRevision: 4, instanceId: external.instanceId }))
      .toMatchObject({ body: { code: 'commit_unknown' } });
    expect(await f.call('status')).toMatchObject({ body: { code: 'commit_unknown' } });
    const committed = (await persisted.load(adapter.descriptor.id))!;
    await persisted.compareAndSet(adapter.descriptor.id, committed.revision, committed.endpoints, 'another-actor');
    expect(await f.call('status')).toMatchObject({ status: 504, body: { code: 'commit_unknown' } });
    expect(adapter.created).toHaveLength(count + 1);
    expect(compareExchange).toHaveBeenCalledTimes(6);
  });

  it('captures per-owner startup defaults once for new accounts and preserves restored desired configuration', async () => {
    const f = await fixture();
    for (const id of [owner, other]) {
      expect(await f.call('endpoint-add', { expectedGeneration: 0, expectedRevision: null, confirmMigration: true,
        id: 'same-name', values: { password: `new-${id}` } }, unrestrictedConsoleAccess, id)).toMatchObject({ status: 200 });
      const adapter = f.adapters.get(id)!;
      const added = f.repository.state.get(adapter.descriptor.id)!.endpoints.find(record => record.endpointId === 'same-name')!;
      expect(added.config).toEqual({ id: 'same-name', password: `new-${id}`, label: 'before' });
      expect(added.config).not.toHaveProperty('master');
    }
    await f.index.stop();
    const restored = new AccountAdapter();
    const slot = createCapabilitySlot({ ...f.slots[0], definition: defineAdapter({ capabilities: ['inbound', 'outbound'], createAdapter: () => restored }) });
    const index = await AdapterIndex.create([slot], { ...f.state, generation: 1,
      config: new Map([[owner, { id: 'legacy-a', password: 'changed', label: 'new-default' }]]) },
    new AbortController().signal, { repository: f.repository });
    cleanup.push(() => index.stop());
    await index.activate(new AbortController().signal);
    expect(restored.configurationView([{ key: 'label' }]).find(row => row.id === 'same-name')?.values.label).toBe('before');
    await restored.add(restored.revision, { endpointId: 'future', config: { password: 'explicit', label: 'override' } });
    const added = f.repository.state.get(restored.descriptor.id)!.endpoints.find(record => record.endpointId === 'future')!;
    expect(added.config).toEqual({ id: 'future', password: 'explicit', label: 'override' });
    expect(restored.configurationView([{ key: 'label' }]).find(row => row.id === 'same-name')?.values.label).toBe('before');
  });

  it('restores authoritative SQLite identities over changed startup seeds, including empty state and read failures', async () => {
    const f = await fixture(); const original = f.adapters.get(owner)!;
    const identity = original.list()[0];
    const directory = await mkdtemp(join(tmpdir(), 'zhin-account-seed-'));
    const config = { dialect: 'sqlite' as const, filename: join(directory, 'state.sqlite') };
    const firstDatabase = createDatabaseHost(config);
    await firstDatabase.start();
    const first = new PersistentEndpointRepository({ rootId: '/fixture', directory: join(directory, 'private'), state: () => firstDatabase.state });
    f.repository.load.mockImplementation(id => first.load(id));
    f.repository.compareAndSet.mockImplementation((...args) => first.compareAndSet(...args));
    try {
      expect(await f.call('endpoint-add', { expectedGeneration: 0, expectedRevision: null, confirmMigration: true,
        id: 'disabled', values: { password: 'synthetic' } })).toMatchObject({ status: 200 });
      await f.index.stop();
    } finally { await firstDatabase.stop(); }
    const reopened = createDatabaseHost(config); await reopened.start();
    cleanup.push(async () => { await reopened.stop(); await rm(directory, { recursive: true, force: true }); });
    const repository = new PersistentEndpointRepository({ rootId: '/fixture', directory: join(directory, 'private'), state: () => reopened.state });
    const restore = async (port: EndpointDesiredRepository) => {
      const adapter = new AccountAdapter();
      const slot = createCapabilitySlot({ ...f.slots[0], definition: defineAdapter({ capabilities: ['inbound', 'outbound'], createAdapter: () => adapter }) });
      const index = await AdapterIndex.create([slot], { ...f.state, generation: 1,
        config: new Map([[owner, { id: 'changed-startup-identity', password: 'changed', label: 'changed-default' }]]) },
      new AbortController().signal, { repository: port });
      cleanup.splice(cleanup.length - 1, 0, () => index.stop());
      return { adapter, index };
    };
    const restored = await restore(repository);
    await restored.index.activate(new AbortController().signal);
    expect(restored.adapter.list()[0]).toMatchObject({ canonicalId: identity.canonicalId, instanceId: identity.instanceId, endpointId: 'legacy-a' });
    expect(restored.adapter.created).toHaveLength(1);
    expect(restored.adapter.configurationView([{ key: 'label' }])[0].values.label).toBe('before');
    expect(restored.adapter.list().find(row => row.endpointId === 'disabled')?.desiredEnabled).toBe(false);
    await restored.index.stop();
    await repository.compareAndSet(original.descriptor.id, 1, []);
    const empty = await restore(repository); await empty.index.activate(new AbortController().signal);
    expect(empty.adapter.list()).toEqual([]); expect(empty.adapter.created).toHaveLength(0);
    const broken = await restore({ load: async () => { throw new AdapterManagementError('unavailable', 'read failed'); },
      compareAndSet: (...args) => repository.compareAndSet(...args) });
    await expect(broken.index.activate(new AbortController().signal)).rejects.toMatchObject({ code: 'unavailable' });
    expect(broken.adapter.created).toHaveLength(0);
  });
});
