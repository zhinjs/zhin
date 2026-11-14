import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { childPluginId, createCapabilitySlot, createSnapshotView, rootPluginId,
  type CapabilityId, type PluginId, type PluginNodeSnapshot, type SnapshotState, type TokenId } from '@zhin.js/plugin-runtime';
import { Adapter, AdapterIndex, AdapterManagementError, adapterFeatureId, compareEndpointDirectories, configuredEndpointSeeds,
  createEndpointSpecification, defineAdapter, endpointEventGatewayToken, endpointSpec, endpointWritebackEntry,
  splitEnvironmentReferences, type Endpoint, type EndpointConfigSource, type EndpointCreationContext, type EndpointDesiredRecord,
  type EndpointDesiredRepository, type EndpointDesiredSnapshot, type EndpointSecretResolver } from '../src/index.js';

const SECRET = 'resolved-credential-value-1234567890';

class StubEndpoint extends EventEmitter implements Endpoint {
  readonly [endpointSpec];
  constructor(readonly config: Record<string, unknown>, start: () => Promise<void>) {
    super();
    this[endpointSpec] = createEndpointSpecification(this, {
      start, open() {}, close() {}, stop: async () => undefined, send: async () => 'message-id', transportState: 'open',
    });
  }
}

class StubAdapter extends Adapter<StubEndpoint> {
  readonly created: StubEndpoint[] = [];
  failWith?: unknown;
  protected createEndpoint(config: Record<string, unknown>, _context: EndpointCreationContext): StubEndpoint {
    const failure = this.failWith;
    const endpoint = new StubEndpoint(config, async () => { if (failure) throw failure; });
    this.created.push(endpoint);
    return endpoint;
  }
}

class Repository implements EndpointDesiredRepository {
  readonly state = new Map<CapabilityId, EndpointDesiredSnapshot>();
  readonly load = vi.fn(async (id: CapabilityId) => structuredClone(this.state.get(id)));
  readonly compareAndSet = vi.fn(async (id: CapabilityId, expected: number | null, endpoints: readonly EndpointDesiredRecord[], commitId?: string) => {
    if ((this.state.get(id)?.revision ?? null) !== expected) throw new AdapterManagementError('conflict', 'conflict');
    const next = structuredClone({ revision: (expected ?? 0) + 1, endpoints, commitId });
    this.state.set(id, next);
    return next;
  });
}

class ConfigFile implements EndpointConfigSource {
  revision = 'r1';
  block: Record<string, unknown> | undefined;
  readonly writes: Array<{ endpoints: readonly Readonly<Record<string, unknown>>[]; expectedRevision: string }> = [];
  constructor(block: Record<string, unknown> | undefined) { this.block = block; }
  async read() { return { config: structuredClone(this.block), revision: this.revision }; }
  async writeEndpoints(_owner: PluginId, endpoints: readonly Readonly<Record<string, unknown>>[], expectedRevision: string) {
    this.writes.push({ endpoints: structuredClone(endpoints), expectedRevision });
    if (expectedRevision !== this.revision) throw new AdapterManagementError('conflict', 'file changed');
    this.block = { ...this.block, endpoints: structuredClone(endpoints) };
    this.revision = `r${Number(this.revision.slice(1)) + 1}`;
    return { revision: this.revision };
  }
  resolveIdentifier(value: string) { return value === '${MAIN_ID}' ? 'main' : value; }
  isSecretKey(key: string) { return /secret|token/iu.test(key); }
}

const secrets: EndpointSecretResolver = {
  resolve: vi.fn(async (reference: string) => {
    if (reference === '${MAIN_SECRET}' || reference === '${NEW_SECRET}') return SECRET;
    throw new AdapterManagementError('invalid_configuration', 'unset');
  }),
};

const disposers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose().catch(() => undefined);
  vi.restoreAllMocks();
});

async function fixture(options: { saved?: readonly EndpointDesiredRecord[]; block?: Record<string, unknown> } = {}) {
  const root = rootPluginId(), owner = childPluginId(root, 'one');
  const adapter = new StubAdapter();
  const slot = createCapabilitySlot({ owner, feature: adapterFeatureId, localName: 'stub', source: '/fixture/adapters/stub/index.ts',
    definition: defineAdapter({ capabilities: ['inbound', 'outbound'], createAdapter: () => adapter }) });
  const repository = new Repository();
  if (options.saved) repository.state.set(slot.id, { revision: 1, endpoints: options.saved.map(record => ({ ...record,
    canonicalId: `${slot.id}~${record.endpointId}` as CapabilityId })) });
  const configFile = new ConfigFile(options.block);
  const state: SnapshotState = { root, tree: new Map<PluginId, PluginNodeSnapshot>([
    [root, { id: root, instanceKey: 'root', packageName: 'fixture', packageRoot: '/fixture', children: [owner] }],
    [owner, { id: owner, parent: root, instanceKey: 'one', packageName: 'fixture-child', packageRoot: '/fixture/child', children: [] }],
  ]), config: new Map([[owner, {}]]), capabilities: new Map([[slot.id, slot]]), projections: new Map(),
  resources: new Map([[owner, new Map<TokenId, unknown>([[endpointEventGatewayToken.id, {
    async run<T>(this: import('@zhin.js/adapter').EndpointEventGateway, receive: (receipt: import('@zhin.js/adapter').EndpointReceipt) => T | Promise<T>) { return receive(this); },
    receive: async () => undefined }]])]]) };
  const index = await AdapterIndex.create([slot], createSnapshotView(0, state), new AbortController().signal,
    { repository, secrets, configSource: configFile, startGraceMs: 0 });
  disposers.push(() => index.stop());
  await index.activate(new AbortController().signal);
  return { adapter, index, repository, configFile, slot };
}

const saved = (endpointId: string, config: Record<string, unknown>, extra: Partial<EndpointDesiredRecord> = {}): EndpointDesiredRecord => ({
  instanceId: endpointId, canonicalId: endpointId as CapabilityId, endpointId, revision: 1, desiredEnabled: true, config: { id: endpointId, ...config }, ...extra,
});

describe('configured endpoint seeds and comparison', () => {
  it('expands entries like the startup seed, resolving only ids', () => {
    const seeds = configuredEndpointSeeds({ mode: 'ws', endpoints: [{ id: '${MAIN_ID}', secret: '${MAIN_SECRET}' }, { id: 'b', mode: 'http' }, { nope: 1 }] },
      'stub', value => value === '${MAIN_ID}' ? 'main' : value);
    expect(seeds.map(seed => [seed.endpointId, seed.config])).toEqual([
      ['main', { mode: 'ws', id: 'main', secret: '${MAIN_SECRET}' }],
      ['b', { mode: 'http', id: 'b' }],
    ]);
    expect(configuredEndpointSeeds({ token: 'x' }, 'stub')).toEqual([{ endpointId: 'stub', singleton: true, config: { token: 'x' } }]);
  });

  it('compares references by spelling, reports paths only and marks reference-vs-value as unverified', () => {
    const seeds = configuredEndpointSeeds({ endpoints: [
      { id: 'same', secret: '${A}' }, { id: 'ref-changed', secret: '${B2}' }, { id: 'legacy', secret: '${C}', url: 'wss://x' },
      { id: 'new', secret: '${D}' },
    ] }, 'stub');
    const records = [saved('same', {}, { secretRefs: { secret: '${A}' } }), saved('ref-changed', {}, { secretRefs: { secret: '${B}' } }),
      saved('legacy', { secret: SECRET, url: 'wss://y' }), saved('gone', { secret: SECRET })];
    const { entries, unverified } = compareEndpointDirectories(seeds, records, key => key === 'secret');
    expect(entries).toEqual([
      { id: 'ref-changed', kind: 'changed', instanceId: 'ref-changed', desiredEnabled: true, fields: [{ path: 'secret', sensitive: true }] },
      { id: 'legacy', kind: 'changed', instanceId: 'legacy', desiredEnabled: true, fields: [{ path: 'url', sensitive: false }] },
      { id: 'new', kind: 'config_only' },
      { id: 'gone', kind: 'snapshot_only', instanceId: 'gone', desiredEnabled: true },
    ]);
    expect(unverified).toEqual([{ id: 'legacy', paths: ['secret'] }]);
    expect(JSON.stringify({ entries, unverified })).not.toContain(SECRET);
  });

  it('moves ${VAR} leaves into secretRefs and refuses references inside lists', () => {
    expect(splitEnvironmentReferences({ id: 'a', secret: '${S}', nested: { token: '${T}', plain: 1 } })).toEqual({
      config: { id: 'a', nested: { plain: 1 } }, secretRefs: { secret: '${S}', 'nested.token': '${T}' } });
    expect(() => splitEnvironmentReferences({ id: 'a', list: ['${S}'] })).toThrow(expect.objectContaining({ code: 'unsupported' }));
  });

  it('writes credentials back only as references or placeholders', () => {
    const written = endpointWritebackEntry({ adapter: 'qq', base: { mode: 'ws', token: '${BASE_TOKEN}' },
      existing: { id: '${MAIN_ID}', secret: '${MAIN_SECRET}' },
      record: { endpointId: 'main', config: { id: 'main', mode: 'ws', secret: SECRET, token: SECRET, password: SECRET, url: 'wss://x' },
        secretRefs: { appKey: '${APP_KEY}' } },
      isSecretKey: key => /secret|token|password|key/iu.test(key), resolveIdentifier: value => value === '${MAIN_ID}' ? 'main' : value });
    expect(written.entry).toEqual({ id: '${MAIN_ID}', appKey: '${APP_KEY}', secret: '${MAIN_SECRET}', password: '${QQ_MAIN_PASSWORD}', url: 'wss://x' });
    expect(written.placeholders).toEqual([{ id: 'main', path: 'password', variable: 'QQ_MAIN_PASSWORD' }]);
    expect(JSON.stringify(written)).not.toContain(SECRET);
  });
});

describe('Adapter configuration drift, import and write-back', () => {
  it('reports no drift while the configuration file still seeds the accounts', async () => {
    const { adapter } = await fixture({ block: { endpoints: [{ id: 'a' }] } });
    await expect(adapter.configDrift()).resolves.toMatchObject({ authority: 'config', revision: null, entries: [] });
  });

  it('logs the drift once on restore with ids and kinds only', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { adapter } = await fixture({ saved: [saved('gone', { secret: SECRET })], block: { endpoints: [{ id: 'new', secret: '${NEW_SECRET}' }] } });
    const drift = await adapter.configDrift();
    expect(drift).toMatchObject({ authority: 'snapshot', revision: 1, configRevision: 'r1' });
    expect(drift.entries.map(entry => [entry.id, entry.kind])).toEqual([['new', 'config_only'], ['gone', 'snapshot_only']]);
    await new Promise(resolve => setTimeout(resolve, 0));
    const output = [...warn.mock.calls, ...log.mock.calls].flat().join('\n');
    expect(output).toContain('endpoint_config_drift');
    expect(output).toContain('configOnly: new');
    expect(output).toContain('savedOnly: gone');
    expect(output).not.toContain(SECRET);
  });

  it('imports a configured account with ${VAR} kept as a reference and starts it on request', async () => {
    const { adapter, index, repository, slot } = await fixture({ saved: [saved('old', { mode: 'ws' })],
      block: { mode: 'ws', endpoints: [{ id: 'old' }, { id: 'new', secret: '${NEW_SECRET}' }] } });
    const result = await adapter.importConfigured('new', 1, { start: true });
    expect(result.revision).toBe(2);
    const persisted = repository.state.get(slot.id)!.endpoints.find(record => record.endpointId === 'new')!;
    expect(persisted).toMatchObject({ canonicalId: `${slot.id}~new`, desiredEnabled: true,
      config: { id: 'new', mode: 'ws' }, secretRefs: { secret: '${NEW_SECRET}' } });
    expect(JSON.stringify(repository.state.get(slot.id))).not.toContain(SECRET);
    expect(adapter.created.at(-1)?.config).toMatchObject({ secret: SECRET });
    expect(index.describe().find(row => row.id === `${slot.id}~new`)).toMatchObject({ phase: 'online' });
    expect((await adapter.configDrift()).entries).toEqual([]);
  });

  it('imports over a changed account, keeping its identity, and refuses a stale revision', async () => {
    const { adapter, repository, slot } = await fixture({ saved: [saved('main', { url: 'wss://old', secret: SECRET }, { platformUserId: 'u1' })],
      block: { endpoints: [{ id: '${MAIN_ID}', url: 'wss://new', secret: '${MAIN_SECRET}' }] } });
    expect(() => adapter.importConfigured('main', 0)).toThrow(expect.objectContaining({ code: 'conflict' }));
    await expect(adapter.importConfigured('missing', 1)).rejects.toMatchObject({ code: 'not_found' });
    await adapter.importConfigured('main', 1);
    const record = repository.state.get(slot.id)!.endpoints[0]!;
    expect(record).toMatchObject({ instanceId: 'main', platformUserId: 'u1', config: { id: 'main', url: 'wss://new' },
      secretRefs: { secret: '${MAIN_SECRET}' }, revision: 2 });
    expect(record.config).not.toHaveProperty('secret');
  });

  it('writes saved accounts back without plaintext and reports placeholders; a moved file is a conflict', async () => {
    const { adapter, configFile } = await fixture({
      saved: [saved('main', { secret: SECRET }), saved('extra', { secret: SECRET, url: 'wss://x' })],
      block: { endpoints: [{ id: '${MAIN_ID}', secret: '${MAIN_SECRET}' }] } });
    const result = await adapter.writeBackConfigured(['main', 'extra']);
    expect(configFile.block?.endpoints).toEqual([
      { id: '${MAIN_ID}', secret: '${MAIN_SECRET}' },
      { id: 'extra', secret: '${STUB_EXTRA_SECRET}', url: 'wss://x' },
    ]);
    expect(result.placeholders).toEqual([{ id: 'extra', path: 'secret', variable: 'STUB_EXTRA_SECRET' }]);
    expect(JSON.stringify(configFile.writes)).not.toContain(SECRET);
    expect(JSON.stringify(result)).not.toContain(SECRET);
    const read = configFile.read.bind(configFile);
    vi.spyOn(configFile, 'read').mockImplementationOnce(async () => ({ ...await read(), revision: 'stale' }));
    await expect(adapter.writeBackConfigured(['main'])).rejects.toMatchObject({ code: 'conflict' });
    await expect(adapter.writeBackConfigured(['nobody'])).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('start failure reasons', () => {
  it('records a classified, credential-free reason', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const root = await fixture({ saved: [saved('main', { token: SECRET })], block: { endpoints: [{ id: 'main', token: '${T}' }] } });
    root.adapter.failWith = Object.assign(new Error(`401 Unauthorized: token ${SECRET} rejected at https://u:p@api.example/x?key=1`), { code: 'E_AUTH' });
    await root.adapter.stop('main', 1);
    await root.adapter.start('main', 2);
    const row = root.index.describe().find(entry => entry.id.endsWith('~main'))!;
    expect(row.startFailure).toMatchObject({ code: 'E_AUTH', category: 'auth', message: expect.stringContaining('E_AUTH') });
    expect(row.startFailure!.message!.length).toBeLessThanOrEqual(200);
    expect(JSON.stringify(row)).not.toContain(SECRET);
    const output = [...warn.mock.calls, ...log.mock.calls].flat().join('\n');
    expect(output).toContain('category: auth');
    expect(output).not.toContain(SECRET);
    expect(output).not.toContain('u:p@');
  });
});
