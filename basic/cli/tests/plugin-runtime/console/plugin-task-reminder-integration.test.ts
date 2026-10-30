import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AdapterIndex, Adapter, endpointSpec, createEndpointSpecification, type Endpoint, adapterFeatureId, defineAdapter, endpointEventGatewayToken } from '@zhin.js/adapter';
import { createHttpHost } from '@zhin.js/host-http';
import { createCapabilitySlot, createSnapshotView, SnapshotStore, PluginStateStore, rootPluginId, childPluginId,
  pluginTaskProviderToken, type PluginId, type TokenId, type SnapshotState } from '@zhin.js/plugin-runtime';
import { ReminderService } from '../../../../../plugins/utils/reminder/src/service.js';
import type { ReminderConfig } from '../../../../../plugins/utils/reminder/src/config.js';
import { createDatabaseHost } from '../../../src/plugin-runtime/database-host-installer.js';
import { registerPluginTaskRoutes } from '../../../src/plugin-runtime/console/plugin-task-routes.js';
import { sqliteAvailable } from '../sqlite-availability.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** Real provider + PluginStateStore CAS + SQLite + AdapterIndex + authenticated HTTP. No network platform sends. */
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'zhin-task-host-integration-'));
  const db = createDatabaseHost({ dialect: 'sqlite', filename: join(directory, 'state.sqlite') }); await db.start();
  cleanups.push(async () => { await db.stop(); await rm(directory, { recursive: true, force: true }); });
  const root = rootPluginId(), owner = childPluginId(root, 'reminder');
  const send = vi.fn<() => Promise<string | null>>().mockResolvedValue('platform-id');
  const stateStore = new PluginStateStore(owner, db.state!);
  const config: ReminderConfig = { timezone: 'UTC', maxTasks: 32, adminMaxTasks: 20, maxTasksPerSender: 10, batchSize: 1, missedGraceSeconds: 15 };
  const service = new ReminderService(stateStore, { send, sendTarget: send }, config);
  class TaskClient { send(): never { throw new Error('Host task setup must not send a probe'); } }
  class TestEndpoint extends TaskClient implements Endpoint {
    readonly [endpointSpec] = createEndpointSpecification(this, { start() {}, open() {}, close() {}, stop() {}, send: () => this.send() });
  }
  const adapter = createCapabilitySlot({ owner: root, feature: adapterFeatureId, localName: 'memory', source: '/adapters/memory/index.ts',
    definition: defineAdapter({ capabilities: ['inbound', 'outbound'], createAdapter: () => new class extends Adapter<TestEndpoint> { protected createEndpoint() { return new TestEndpoint(); } }() }) });
  const base: SnapshotState = {
    root, tree: new Map([
      [root, { id: root, instanceKey: 'root', packageName: 'app', packageRoot: directory, children: [owner] }],
      [owner, { id: owner, instanceKey: 'reminder', packageName: '@zhin.js/plugin-reminder', packageRoot: directory, parent: root, children: [] }],
    ]), config: new Map(), resources: new Map<PluginId, ReadonlyMap<TokenId, unknown>>([
      [root, new Map([[endpointEventGatewayToken.id, { receive: async () => undefined }]])],
      [owner, new Map([[pluginTaskProviderToken.id, service.administratorTasks]])],
    ]), capabilities: new Map([[adapter.id, adapter]]), projections: new Map(),
  };
  const adapters = await AdapterIndex.create([adapter], createSnapshotView(0, base), new AbortController().signal);
  const snapshots = new SnapshotStore({ ...base, projections: new Map([[adapterFeatureId, adapters]]) });
  const target = { endpoint: { id: String(adapter.id), adapter: adapters.clientAdapter(adapter.id) }, kind: 'group' as const, id: 'demo-group' };
  const http = createHttpHost({ host: '127.0.0.1', port: 0, token: 'operator', tokens: [{ token: 'demo', scope: 'demo' }] });
  registerPluginTaskRoutes({ http, base: '/api', snapshots }); const { port } = await http.listen();
  cleanups.push(async () => { await http.close(); service.stop(); await snapshots.close(); await adapters.stop(); });
  const request = (path = '/providers', input?: unknown, token = 'operator') => fetch(`http://127.0.0.1:${port}/api/tasks${path}`, {
    method: input === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(input === undefined ? {} : { body: typeof input === 'string' ? input : JSON.stringify(input) }),
  });
  const read = async () => { const response = await request(); expect(response.status).toBe(200); return response.json(); };
  return { owner, target, request, read, service, send, stateStore };
}

describe.skipIf(!sqliteAvailable)('real reminder provider through task Host', () => {
  it.each([300, 500])('creates and reads %i-character content without losing text or poisoning provider output', async length => {
    const f = await fixture(); const clock = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    const initial = (await f.read()).data.providers[0]; const text = '示'.repeat(length), requestId = randomUUID();
    const input = { generation: 0, owner: f.owner, requestId, expectedRevision: initial.revision, target: f.target,
      parameters: { text, at: new Date(Date.now() + 60_000).toISOString() } };
    const response = await f.request('/create', input); expect(response.status).toBe(200);
    const envelope = await response.json(); expect(envelope.success).toBe(true);
    const created = envelope.data.provider;
    expect(created.tasks).toHaveLength(1); expect(created.tasks[0].title.length).toBeLessThanOrEqual(200);
    expect(created.tasks[0].parameters.text).toBe(text); expect(created.tasks[0].ownership).toBe('administrator');
    expect(created.receipts).toContainEqual({ requestId, taskId: requestId, operation: 'create' });
    expect((await f.read()).data.providers[0]).toEqual(created);
    const repeated = await f.request('/create', input); expect(repeated.status).toBe(200);
    expect((await repeated.json()).data.provider.tasks).toHaveLength(1); expect(f.send).not.toHaveBeenCalled();
    clock.mockRestore();
  });

  it('returns the actionable expired-resume instruction from the real provider without changing the paused task', async () => {
    const f = await fixture(); const clock = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    const initial = (await f.read()).data.providers[0], id = randomUUID();
    const created = await f.request('/create', { generation: 0, owner: f.owner, requestId: id, expectedRevision: initial.revision,
      target: f.target, parameters: { text: 'demo reminder', at: new Date(Date.now() + 1000).toISOString() } });
    let provider = (await created.json()).data.provider;
    const pause = await f.request('/change', { generation: 0, owner: f.owner, requestId: randomUUID(), expectedRevision: provider.revision, id, action: 'pause' });
    provider = (await pause.json()).data.provider; clock.mockReturnValue(Date.now() + 2000);
    const response = await f.request('/change', { generation: 0, owner: f.owner, requestId: randomUUID(), expectedRevision: provider.revision, id, action: 'resume' });
    expect(response.status).toBe(400); expect((await response.json()).error).toContain('先编辑为未来时间再恢复');
    expect((await f.read()).data.providers[0].tasks[0].state).toBe('paused'); expect(f.send).not.toHaveBeenCalled();
  });

  it('explains that unknown delivery cannot be resumed and never resends while viewing or rejecting it', async () => {
    const f = await fixture(); const clock = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    const initial = (await f.read()).data.providers[0], id = randomUUID();
    await f.request('/create', { generation: 0, owner: f.owner, requestId: id, expectedRevision: initial.revision,
      target: f.target, parameters: { text: 'demo unknown', at: new Date(Date.now() + 1000).toISOString() } });
    f.send.mockResolvedValueOnce(null); clock.mockReturnValue(Date.now() + 1000); await f.service.tick();
    const provider = (await f.read()).data.providers[0]; expect(provider.tasks[0].state).toBe('unknown');
    const response = await f.request('/change', { generation: 0, owner: f.owner, requestId: randomUUID(), expectedRevision: provider.revision, id, action: 'resume' });
    expect(response.status).toBe(400); expect((await response.json()).error).toContain('未确认投递不能恢复或重试');
    await f.service.tick(); expect(f.send).toHaveBeenCalledTimes(1);
  });

  it('does not execute the real provider for malformed JSON or unauthorized requests', async () => {
    const f = await fixture(); const create = vi.spyOn(f.service.administratorTasks, 'create');
    const change = vi.spyOn(f.service.administratorTasks, 'change'), read = vi.spyOn(f.service.administratorTasks, 'read');
    expect((await f.request('/create', '{')).status).toBe(400);
    expect((await f.request('/create', {}, 'demo')).status).toBe(403);
    expect((await f.request('/providers', undefined, 'invalid')).status).toBe(401);
    expect(create).not.toHaveBeenCalled(); expect(change).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  });
});
