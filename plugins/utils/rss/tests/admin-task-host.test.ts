import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Adapter, adapterFeatureId, AdapterIndex, createEndpointSpecification, defineAdapter, endpointSpec, endpointEventGatewayToken } from '../../../../packages/im/adapter/src/index.js';
import { createHttpHost } from '../../../../packages/host/http/src/index.js';
import { childPluginId, createCapabilitySlot, createSnapshotView, PluginStateStore, pluginTaskProviderToken, rootPluginId,
  SnapshotStore, type SnapshotState } from '../../../../packages/im/plugin-runtime/src/index.js';
import { registerPluginTaskRoutes } from '../../../../basic/cli/src/plugin-runtime/console/plugin-task-routes.js';
import { createDatabaseHost } from '../../../../basic/cli/src/plugin-runtime/database-host-installer.js';
import { sqliteAvailable } from '../../../../basic/cli/tests/plugin-runtime/sqlite-availability.js';
import { AdministratorRssTasks, ADMIN_RSS_STATE_KEY, type AdministratorRssBook } from '../src/admin-tasks.js';
import { resolveRssConfig } from '../src/feed.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); vi.restoreAllMocks(); });
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'zhin-rss-task-host-'));
  const database = createDatabaseHost({ dialect: 'sqlite', filename: join(directory, 'state.sqlite') }); await database.start();
  cleanups.push(async () => { await database.stop(); await rm(directory, { recursive: true, force: true }); });
  const root = rootPluginId(), owner = childPluginId(root, 'rss');
  const send = vi.fn<() => Promise<string | null>>().mockResolvedValue('message-id');
  const load = vi.fn().mockResolvedValue({ title: 'Source', items: [] });
  const stateStore = new PluginStateStore(owner, database.state!);
  const provider = new AdministratorRssTasks(stateStore, { send, sendTarget: send }, resolveRssConfig({}), load);
  class TestClient {
    send() { throw new Error('Reading/creating a task must not send platform probes'); }
  }
  class TestEndpoint extends TestClient {
    readonly [endpointSpec] = createEndpointSpecification(this, {
      start() {}, open() {}, close() {}, stop() {}, send: () => this.send(),
    });
  }
  class TestAdapter extends Adapter<TestEndpoint> { protected createEndpoint() { return new TestEndpoint(); } }
  const adapter = createCapabilitySlot({ owner: root, feature: adapterFeatureId, localName: 'sandbox', source: '/adapters/sandbox/index.ts',
    definition: defineAdapter({ capabilities: ['inbound', 'outbound'], createAdapter: () => new TestAdapter() }) });
  const state: SnapshotState = { root, tree: new Map([
    [root, { id: root, instanceKey: 'root', packageName: '@test/app', packageRoot: directory, children: [owner] }],
    [owner, { id: owner, instanceKey: 'rss', packageName: '@zhin.js/plugin-rss', packageRoot: directory, parent: root, children: [] }],
  ]), config: new Map(), resources: new Map([
    [root, new Map([[endpointEventGatewayToken.id, { receive: async () => undefined }]])],
    [owner, new Map([[pluginTaskProviderToken.id, provider]])],
  ]), capabilities: new Map([[adapter.id, adapter]]), projections: new Map() };
  const adapters = await AdapterIndex.create([adapter], createSnapshotView(0, state), new AbortController().signal);
  const snapshots = new SnapshotStore({ ...state, projections: new Map([[adapterFeatureId, adapters]]) });
  const target = { endpoint: { id: String(adapter.id), adapter: adapters.clientAdapter(adapter.id) }, kind: 'channel' as const,
    id: 'channel', parent: { kind: 'channel' as const, id: 'parent' }, threadId: 'thread' };
  const http = createHttpHost({ host: '127.0.0.1', port: 0, token: 'synthetic-operator', tokens: [{ token: 'synthetic-demo', scope: 'demo' }] });
  registerPluginTaskRoutes({ http, base: '/api', snapshots }); const { port } = await http.listen();
  cleanups.push(async () => { await http.close(); provider.stop(); await snapshots.close(); await adapters.stop(); });
  const request = (path = '/providers', body?: unknown, token = 'synthetic-operator') => fetch(`http://127.0.0.1:${port}/api/tasks${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const read = async () => { const response = await request(); expect(response.status).toBe(200); return (await response.json()).data.providers[0]; };
  return { owner, target, provider, request, read, send, load, stateStore };
}

describe.skipIf(!sqliteAvailable)('real administrator RSS provider through authenticated task Host', () => {
  it('exposes the existing generic URL schema and preserves a full target without fetching or sending on create/read', async () => {
    const f = await fixture(), initial = await f.read(), requestId = randomUUID();
    const useCases = await f.request('/use-cases'); expect(useCases.status).toBe(200);
    expect((await useCases.json()).data.find((item: { id: string }) => item.id === 'rss-subscription'))
      .toMatchObject({ mode: 'administrator-task', packageName: initial.packageName });
    expect(initial.schema.properties.url).toMatchObject({ type: 'string', title: 'RSS / Atom 地址' });
    expect(initial.effects.join(' ')).toContain('基线'); expect(initial.tasks).toEqual([]);
    const input = { generation: 0, owner: f.owner, expectedRevision: initial.revision, requestId, target: f.target, parameters: { url: 'https://example.test/feed' } };
    const response = await f.request('/create', input); expect(response.status).toBe(200);
    const created = (await response.json()).data.provider;
    expect(created.tasks[0]).toMatchObject({ id: requestId, ownership: 'administrator', target: f.target, state: 'scheduled', parameters: input.parameters });
    expect(created.tasks[0].nextRunAt).toBeUndefined(); expect(created.tasks[0].senderId).toBeUndefined();
    expect(created.receipts).toContainEqual({ requestId, taskId: requestId, operation: 'create' });
    expect(await f.read()).toEqual(created);
    const repeated = await f.request('/create', input); expect(repeated.status).toBe(200); expect((await repeated.json()).data.provider).toEqual(created);
    expect(f.load).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  });

  it('mutates the provider facts with pause/edit/resume/cancel and reconciles a repeated cancellation', async () => {
    const f = await fixture(); let snapshot = await f.read(); const id = randomUUID();
    const created = await f.request('/create', { generation: 0, owner: f.owner, requestId: id, expectedRevision: snapshot.revision, target: f.target,
      parameters: { url: 'https://example.test/feed' } }); snapshot = (await created.json()).data.provider;
    for (const action of ['pause', 'update', 'resume', 'cancel']) {
      const input = { generation: 0, owner: f.owner, requestId: randomUUID(), expectedRevision: snapshot.revision, id, action,
        ...(action === 'update' ? { parameters: { url: 'https://other.test/feed' } } : {}) };
      const response = await f.request('/change', input); expect(response.status).toBe(200); snapshot = (await response.json()).data.provider;
      if (action === 'cancel') { expect(snapshot.tasks[0].state).toBe('cancelled'); const repeat = await f.request('/change', input);
        expect(repeat.status).toBe(200); expect((await repeat.json()).data.provider).toEqual(snapshot); }
    }
    expect(snapshot.tasks[0].parameters.url).toBe('https://other.test/feed'); expect(f.load).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  });

  it('preserves flat quiet parameters through the authenticated generic Host and turns them off when the real form clears all three', async () => {
    const f = await fixture(), initial = await f.read(), requestId = randomUUID();
    for (const key of ['quietTimezone', 'quietStart', 'quietEnd']) expect(initial.schema.properties[key]).toMatchObject({ type: 'string' });
    expect(initial.schema.required).toEqual(['url']);
    const parameters = { url: 'https://example.test/feed', quietTimezone: 'Asia/Shanghai', quietStart: '22:00', quietEnd: '08:00' };
    const input = { generation: 0, owner: f.owner, requestId, expectedRevision: initial.revision, target: f.target, parameters };
    const created = await f.request('/create', input); expect(created.status).toBe(200);
    let snapshot = (await created.json()).data.provider;
    expect(snapshot.tasks[0]).toMatchObject({ target: f.target, parameters }); expect(snapshot.tasks[0].nextRunAt).toBeUndefined();
    const replay = await f.request('/create', input); expect(replay.status).toBe(200); expect((await replay.json()).data.provider).toEqual(snapshot);
    expect((await f.request('/create', { ...input, parameters: { ...parameters, quietEnd: '09:00' } })).status).toBe(409);
    const paused = await f.request('/change', { generation: 0, owner: f.owner, requestId: randomUUID(), expectedRevision: snapshot.revision, id: requestId, action: 'pause' });
    expect(paused.status).toBe(200); snapshot = (await paused.json()).data.provider;
    const edited = await f.request('/change', { generation: 0, owner: f.owner, requestId: randomUUID(), expectedRevision: snapshot.revision, id: requestId, action: 'update',
      parameters: { ...snapshot.tasks[0].parameters, quietTimezone: '', quietStart: '', quietEnd: '' } });
    expect(edited.status).toBe(200); expect((await edited.json()).data.provider.tasks[0].parameters).toEqual({ url: parameters.url });
    expect(f.load).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  });

  it.each([
    { quietTimezone: 'Asia/Shanghai' },
    { quietTimezone: '+08:00', quietStart: '22:00', quietEnd: '08:00' },
    { quietTimezone: 'UTC', quietStart: '08:00', quietEnd: '08:00' },
  ])('rejects invalid quiet settings before persistence or any network effects: %j', async quiet => {
    const f = await fixture(), initial = await f.read();
    const response = await f.request('/create', { generation: 0, owner: f.owner, requestId: randomUUID(), expectedRevision: initial.revision,
      target: f.target, parameters: { url: 'https://example.test/feed', ...quiet } });
    expect(response.status).toBe(400); expect(await response.json()).toMatchObject({ success: false, code: 'invalid_input' });
    expect(await f.read()).toEqual(initial); expect(f.load).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  });

  it('rejects unauthorized, stale generation and wrong endpoint identity before invoking the provider', async () => {
    const f = await fixture(), initial = await f.read(); const read = vi.spyOn(f.provider, 'read'), create = vi.spyOn(f.provider, 'create');
    expect((await f.request('/providers', undefined, 'synthetic-demo')).status).toBe(403);
    expect((await f.request('/providers', undefined, 'invalid')).status).toBe(401); expect(read).not.toHaveBeenCalled();
    const input = { generation: 1, owner: f.owner, requestId: randomUUID(), expectedRevision: initial.revision, target: f.target, parameters: { url: 'https://example.test/feed' } };
    expect((await f.request('/create', input)).status).toBe(409);
    expect((await f.request('/create', { ...input, generation: 0, target: { ...f.target, endpoint: { ...f.target.endpoint, adapter: 'wrong' } } })).status).toBe(400);
    expect(create).not.toHaveBeenCalled(); expect(f.load).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  });

  it('explains unknown delivery through the real Host without silently retrying it', async () => {
    const f = await fixture(), initial = await f.read(); const id = randomUUID();
    await f.request('/create', { generation: 0, owner: f.owner, requestId: id, expectedRevision: initial.revision, target: f.target, parameters: { url: 'https://example.test/feed' } });
    await f.provider.tick(); f.load.mockResolvedValue({ title: 'Source', items: [{ guid: 'new', title: 'New article', summary: '', link: '', date: '' }] });
    f.send.mockResolvedValue(null); await f.provider.tick(); const snapshot = await f.read();
    expect(snapshot.tasks[0]).toMatchObject({ state: 'unknown', actions: ['cancel'] });
    const response = await f.request('/change', { generation: 0, owner: f.owner, requestId: randomUUID(), expectedRevision: snapshot.revision, id, action: 'resume' });
    expect(response.status).toBe(400); expect((await response.json()).error).toContain('不能恢复或重试');
    await f.provider.tick(); expect(f.send).toHaveBeenCalledTimes(1);
  });

  it.each(['createdAt', 'lastCheckAt', 'lastRunAt'] as const)('fails closed for an out-of-Date-range durable %s without overwriting evidence', async field => {
    const f = await fixture(), initial = await f.read();
    const created = await f.request('/create', { generation: 0, owner: f.owner, requestId: randomUUID(), expectedRevision: initial.revision,
      target: f.target, parameters: { url: 'https://example.test/feed' } });
    expect(created.status).toBe(200);
    const current = await f.stateStore.get<AdministratorRssBook>(ADMIN_RSS_STATE_KEY);
    const broken = { ...current!, tasks: current!.tasks.map(task => ({ ...task, [field]: Number.MAX_SAFE_INTEGER })) };
    await f.stateStore.set(ADMIN_RSS_STATE_KEY, broken);
    const response = await f.request(); expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ success: false, code: 'unavailable' });
    await expect(f.provider.tick()).rejects.toMatchObject({ code: 'unavailable' });
    expect(f.load).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
    expect(await f.stateStore.get(ADMIN_RSS_STATE_KEY)).toEqual(broken);
  });
});
