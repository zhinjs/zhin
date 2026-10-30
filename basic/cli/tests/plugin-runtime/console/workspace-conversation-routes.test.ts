import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AdapterIndex, Endpoint, adapterFeatureId, defineAdapter, endpointEventGatewayToken } from '@zhin.js/adapter';
import { createHttpHost } from '@zhin.js/host-http';
import { createCapabilitySlot, createSnapshotView, SnapshotStore, rootPluginId, childPluginId, type SnapshotState } from '@zhin.js/plugin-runtime';
import { createDatabaseHost } from '../../../src/plugin-runtime/database-host-installer.js';
import { registerWorkspaceConversationRoutes } from '../../../src/plugin-runtime/console/workspace-conversation-routes.js';
import { defineWorkspaceConversationTable } from '../../../src/plugin-runtime/console/workspace-conversations.js';
import { sqliteAvailable } from '../sqlite-availability.js';

const cleanups: Array<() => Promise<void>> = [];
let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'zhin-workspace-directory-')); });
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  await rm(directory, { recursive: true, force: true });
});

const conversation = { id: 'room:中文\0%', type: 'private', name: '一个工作会话', runConfig: {
  workingDirectory: 'src/项目', safetyMode: 'workspace-write', approvalMode: 'ask', networkAccess: false,
} };

/** Real SQLite, generation AdapterIndex, and authenticated HTTP; no provider or platform sends. */
async function fixture(options: { filename?: string; unavailable?: boolean } = {}) {
  const db = createDatabaseHost({ dialect: 'sqlite', filename: options.filename ?? join(directory, 'directory.sqlite') });
  defineWorkspaceConversationTable(db);
  await db.start();
  const connection = (owner: string) => ({ target: 'sandbox-bot', owner, placeholder: false, socket: { readyState: 1 } });
  const connections = new Map([['first-page', connection('configured-owner')], ['second-page', connection('configured-owner')], ['other-owner', connection('other-owner')]]);
  const secondConnections = new Map([['other-endpoint', connection('configured-owner')]]);
  class TestEndpoint extends Endpoint<object> {
    constructor(readonly client: object) { super(); }
    start() {} open() {} close() {} stop() {}
    send() { throw new Error('Directory reads and writes must not send messages'); }
  }
  const root = rootPluginId(), owners = [childPluginId(root, 'sandbox-one'), childPluginId(root, 'sandbox-two')];
  const slots = owners.map((owner, index) => createCapabilitySlot({ owner, feature: adapterFeatureId, localName: 'sandbox', source: '/sandbox/adapters/index.ts',
    definition: defineAdapter({ capabilities: ['inbound', 'outbound'], create: () => new TestEndpoint({
      connectionById: (id: string) => (index === 0 ? connections : secondConnections).get(id),
    }) }) }));
  const base: SnapshotState = { root, tree: new Map([
    [root, { id: root, instanceKey: 'root', packageName: 'app', packageRoot: directory, children: owners }],
    ...owners.map(owner => [owner, { id: owner, instanceKey: String(owner), packageName: '@zhin.js/adapter-sandbox', packageRoot: directory, parent: root, children: [] }] as const),
  ]), config: new Map(), resources: new Map(owners.map(owner => [owner, new Map([[endpointEventGatewayToken.id, { receive: async () => undefined }]])])),
  capabilities: new Map(slots.map(slot => [slot.id, slot])), projections: new Map() };
  const adapters = await AdapterIndex.create(slots, createSnapshotView(0, base), new AbortController().signal);
  await adapters.activate(new AbortController().signal);
  const snapshots = new SnapshotStore({ ...base, projections: new Map([[adapterFeatureId, adapters]]) });
  const http = createHttpHost({ host: '127.0.0.1', port: 0, token: 'operator', tokens: [{ token: 'demo', scope: 'demo' }] });
  registerWorkspaceConversationRoutes({ http, base: '/api', snapshots, databaseHost: options.unavailable ? undefined : db });
  const { port } = await http.listen();
  cleanups.push(async () => { await http.close(); await snapshots.close(); await adapters.stop(); await db.stop(); });
  const read = (connectionId = 'first-page', token = 'operator') => fetch(`http://127.0.0.1:${port}/api/conversations/workspaces?${new URLSearchParams({ connectionId })}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const save = (input: unknown = { connectionId: 'first-page', conversation, expectedRevision: null }, token = 'operator') => fetch(`http://127.0.0.1:${port}/api/conversations/workspaces`, {
    method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: typeof input === 'string' ? input : JSON.stringify(input),
  });
  return { db, snapshots, read, save, connections, endpointId: String(slots[0]!.id) };
}

describe.skipIf(!sqliteAvailable)('Console workspace directory', () => {
  it('keeps names and run configuration across Host restarts without copying chat or browser history', async () => {
    const filename = join(directory, 'restart.sqlite');
    const first = await fixture({ filename });
    expect((await (await first.read()).json()).data.items).toEqual([]);
    const response = await first.save({ connectionId: 'first-page', conversation, expectedRevision: null, ownerId: 'forged', endpoint: 'forged', messages: ['not stored'] });
    expect(response.status).toBe(200);
    const written = (await response.json()).data;
    expect(written.scope).toEqual({ endpoint: { adapter: 'sandbox', id: first.endpointId }, endpointKey: 'sandbox-bot', ownerId: 'configured-owner', connectionId: 'first-page' });
    expect(written.item).toMatchObject(conversation);
    await first.db.stop();
    const restarted = await fixture({ filename });
    const restored = await restarted.read('second-page');
    expect(restored.status).toBe(200);
    expect(restored.headers.get('cache-control')).toBe('no-store');
    expect((await restored.json()).data.items).toEqual([written.item]);
    const rows = await restarted.db.models.get('console_conversations')!.select('id', 'name', 'run_config');
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toMatch(/not stored|forged/);
    expect(restarted.db.tables()).toEqual(['console_conversations']);
  });

  it('shares an owner across live pages and reconnects while isolating other configured owners, endpoints, and scene types', async () => {
    const f = await fixture();
    const item = (await (await f.save()).json()).data.item;
    expect((await (await f.read('second-page')).json()).data.items).toEqual([item]);
    for (const connectionId of ['other-owner', 'other-endpoint']) expect((await (await f.read(connectionId)).json()).data.items).toEqual([]);
    f.connections.delete('first-page');
    f.connections.set('reconnected', { target: 'random-reconnect-target', owner: 'configured-owner', placeholder: false, socket: { readyState: 1 } });
    expect((await (await f.read('reconnected')).json()).data.items).toEqual([item]);
    expect((await f.read('first-page')).status).toBe(503);
    const group = { ...conversation, type: 'group' };
    expect((await f.save({ connectionId: 'reconnected', conversation: group, expectedRevision: null })).status).toBe(200);
    expect((await (await f.read('reconnected')).json()).data.items).toEqual(expect.arrayContaining([item, expect.objectContaining({ type: 'group' })]));
  });

  it('uses one explicit compare-and-swap for concurrent creation and updates rather than overwriting another page', async () => {
    const f = await fixture();
    const created = await Promise.all([f.save(), f.save()]);
    expect(created.map(response => response.status).sort()).toEqual([200, 409]);
    const original = (await (await f.read()).json()).data.items[0];
    const updates = await Promise.all(['first edit', 'second edit'].map(name => f.save({
      connectionId: 'second-page', conversation: { ...conversation, name }, expectedRevision: original.revision,
    })));
    expect(updates.map(response => response.status).sort()).toEqual([200, 409]);
    const conflict = await updates.find(response => response.status === 409)!.json();
    expect(conflict.code).toBe('revision_conflict');
    const [latest] = (await (await f.read()).json()).data.items;
    expect(latest.revision).not.toBe(original.revision);
    expect(['first edit', 'second edit']).toContain(latest.name);
    expect((await f.save({ connectionId: 'first-page', conversation, expectedRevision: null })).status).toBe(409);
    expect((await f.save({ connectionId: 'first-page', conversation: { ...conversation, id: 'absent' }, expectedRevision: original.revision })).status).toBe(409);
  });

  it('requires full credentials and an actual live binding before touching metadata', async () => {
    const f = await fixture();
    const select = vi.spyOn(f.db.models.get('console_conversations')!, 'select');
    for (const request of [() => f.read('first-page', 'demo'), () => f.save(undefined, 'demo')]) expect((await request()).status).toBe(403);
    expect((await f.read('first-page', 'invalid')).status).toBe(401);
    for (const id of ['unknown', 'closed', 'placeholder']) {
      if (id !== 'unknown') f.connections.set(id, { target: 'sandbox-bot', owner: 'configured-owner', placeholder: id === 'placeholder', socket: { readyState: id === 'closed' ? 3 : 1 } });
      const response = await f.read(id);
      expect(response.status).toBe(503);
      expect((await response.json()).code).toBe('sandbox_binding_unavailable');
    }
    expect(select).not.toHaveBeenCalled();
    await f.snapshots.close();
    expect((await (await f.read()).json()).code).toBe('sandbox_binding_unavailable');
  });

  it('distinguishes an absent store from database read errors and uncertain committed writes without retrying', async () => {
    const absent = await fixture({ unavailable: true });
    expect((await (await absent.read()).json()).code).toBe('workspace_store_unavailable');
    const f = await fixture({ filename: join(directory, 'failure.sqlite') });
    const model = f.db.models.get('console_conversations')!;
    const select = vi.spyOn(model, 'select').mockImplementationOnce(() => { throw Error('query failed'); });
    expect((await (await f.read()).json()).code).toBe('workspace_store_error');
    select.mockRestore();
    const transact = f.db.transaction!.bind(f.db);
    const mutation = vi.spyOn(f.db, 'transaction').mockImplementationOnce(async operation => {
      await transact(operation);
      throw Error('commit acknowledgement unavailable');
    });
    const response = await f.save();
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe('workspace_store_error');
    expect(mutation).toHaveBeenCalledTimes(1);
    expect((await (await f.read()).json()).data.items).toEqual([expect.objectContaining(conversation)]);
  });

  it.each([
    {}, { expectedRevision: undefined }, { expectedRevision: 1 }, { conversation: { ...conversation, type: ['group'] } },
    { conversation: { ...conversation, name: '' } }, { conversation: { ...conversation, id: 'x'.repeat(257) } },
    { conversation: { ...conversation, runConfig: { ...conversation.runConfig, approvalMode: 'yolo' } } },
    { conversation: { ...conversation, runConfig: { ...conversation.runConfig, networkAccess: 'true' } } },
  ])('validates metadata without executing or silently defaulting invalid settings: %j', async invalid => {
    const f = await fixture();
    const input = Object.keys(invalid).length ? { connectionId: 'first-page', conversation, expectedRevision: null, ...invalid } : {};
    expect((await f.save(input)).status).toBe(400);
    expect((await (await f.read()).json()).data.items).toEqual([]);
  });

  it('reports malformed JSON precisely and preserves existing danger-mode network normalization', async () => {
    const f = await fixture();
    expect((await f.save('{')).status).toBe(400);
    const response = await f.save({ connectionId: 'first-page', expectedRevision: null, conversation: { ...conversation,
      runConfig: { ...conversation.runConfig, safetyMode: 'danger-full-access', networkAccess: false } } });
    expect(response.status).toBe(200);
    expect((await response.json()).data.item.runConfig.networkAccess).toBe(true);
  });
});
