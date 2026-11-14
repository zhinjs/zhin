import { mkdtemp, rm } from 'node:fs/promises';
import { withTestUsers } from '../utils/console-users.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AdapterIndex, Adapter, endpointSpec, createEndpointSpecification, type Endpoint, adapterFeatureId, defineAdapter, endpointEventGatewayToken } from '@zhin.js/adapter';
import { createHttpHost } from '@zhin.js/host-http/node';
import { createCapabilitySlot, createSnapshotView, resolveEndpointFeatureKey, SnapshotStore, rootPluginId, childPluginId, type PluginId, type PluginNodeSnapshot, type SnapshotState } from '@zhin.js/plugin-runtime';
import { createDatabaseHost } from '@zhin.js/core/runtime';
import { registerWorkspaceConversationRoutes } from '../../../src/instance/console/workspace-conversation-routes.js';
import { defineWorkspaceConversationTable, readWorkspaceConversationNames } from '../../../src/instance/console/workspace-conversations.js';
import { sqliteAvailable } from '../sqlite-availability.js';
import { CommandIndex, commandFeatureId, defineCommand } from '@zhin.js/command';

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
async function fixture(options: { filename?: string; unavailable?: boolean;
  commands?: { prefix?: string; menuKeyword?: string | false; names?: readonly (string | { name: string; permit?: string[]; params?: Record<string, { type: 'string'; optional?: boolean }>; alias?: string[]; preferredAliasI18n?: Record<string, string> })[] } } = {}) {
  const db = createDatabaseHost({ dialect: 'sqlite', filename: options.filename ?? join(directory, 'directory.sqlite') });
  defineWorkspaceConversationTable(db);
  await db.start();
  const connection = (owner: string) => ({ target: 'sandbox-bot', owner, placeholder: false, socket: { readyState: 1 } });
  const connections = new Map([['first-page', connection('configured-owner')], ['second-page', connection('configured-owner')], ['other-owner', connection('other-owner')]]);
  const secondConnections = new Map([['other-endpoint', connection('configured-owner')]]);
  type WorkspaceConnections = typeof connections;
  class WorkspaceClient {
    constructor(private readonly records: WorkspaceConnections) {}
    connectionById(id: string) { return this.records.get(id); }
    connections() { return [...this.records.values()]; }
    send(): never { throw new Error('Directory reads and writes must not send messages'); }
  }
  class TestEndpoint extends WorkspaceClient implements Endpoint {
    readonly [endpointSpec] = createEndpointSpecification(this, { start() {}, open() {}, close() {}, stop() {}, send: () => this.send() });
  }
  const root = rootPluginId(), owners = [childPluginId(root, 'sandbox-one'), childPluginId(root, 'sandbox-two')];
  const slots = owners.map((owner, index) => createCapabilitySlot({ owner, feature: adapterFeatureId, localName: 'sandbox', source: '/sandbox/adapters/index.ts',
    definition: defineAdapter({ capabilities: ['inbound', 'outbound'], profile: { default: { delivery: { send: true }, runtime: { sandbox: true } } }, createAdapter: () => new class extends Adapter<TestEndpoint> { protected createEndpoint() { return new TestEndpoint(index === 0 ? connections : secondConnections); } }() }) }));
  const commandSlots = (options.commands?.names ?? []).map(item => {
    const command = typeof item === 'string' ? { name: item } : item;
    return createCapabilitySlot({ owner: root, feature: commandFeatureId, localName: command.name,
      source: `/app/commands/${command.name}/index.ts`,
      definition: defineCommand({ ...(command.permit ? { permit: command.permit } : {}), ...('params' in command && command.params ? { params: command.params } : {}),
        ...('alias' in command && command.alias ? { alias: command.alias } : {}),
        ...('preferredAliasI18n' in command && command.preferredAliasI18n ? { preferredAliasI18n: command.preferredAliasI18n } : {}), execute: () => 'ok' }) });
  });
  const config = new Map<PluginId, unknown>();
  if (options.commands?.prefix !== undefined) config.set(owners[0]!, { commandPrefix: options.commands.prefix });
  if (options.commands?.menuKeyword !== undefined) config.set(root, { menuKeyword: options.commands.menuKeyword });
  const base: SnapshotState = { root, tree: new Map<PluginId, PluginNodeSnapshot>([
    [root, { id: root, instanceKey: 'root', packageName: 'app', packageRoot: directory, children: owners }],
    ...owners.map(owner => [owner, { id: owner, instanceKey: String(owner).split('/').pop()!, packageName: '@zhin.js/adapter-sandbox', packageRoot: directory, parent: root, children: [] }] as const),
  ]), config, resources: new Map(owners.map(owner => [owner, new Map([[endpointEventGatewayToken.id, { receive: async () => undefined }]])])),
  capabilities: new Map([...slots, ...commandSlots].map(slot => [slot.id, slot])), projections: new Map() };
  const adapters = await AdapterIndex.create(slots, createSnapshotView(0, base), new AbortController().signal);
  await adapters.activate(new AbortController().signal);
  const projections = new Map<unknown, unknown>([[adapterFeatureId, adapters]]);
  if (options.commands) {
    const keyword = options.commands.menuKeyword;
    projections.set(commandFeatureId, new CommandIndex(commandSlots as never, createSnapshotView(0, { ...base, projections: projections as never }),
      keyword === false ? undefined : typeof keyword === 'string' ? { keyword } : {}));
  }
  const snapshots = new SnapshotStore({ ...base, projections: projections as never });
  const http = withTestUsers(createHttpHost({ host: '127.0.0.1', port: 0 }), { operator: 'owner', demo: 'none' });
  registerWorkspaceConversationRoutes({ http, base: '/api', snapshots, databaseHost: options.unavailable ? undefined : db });
  const { port } = await http.listen();
  cleanups.push(async () => { await http.close(); await snapshots.close(); await adapters.stop(); await db.stop(); });
  const read = (connectionId = 'first-page', token = 'operator') => fetch(`http://127.0.0.1:${port}/api/conversations/workspaces?${new URLSearchParams({ connectionId })}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const save = (input: unknown = { connectionId: 'first-page', conversation, expectedRevision: null }, token = 'operator') => fetch(`http://127.0.0.1:${port}/api/conversations/workspaces`, {
    method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: typeof input === 'string' ? input : JSON.stringify(input),
  });
  const commands = (query: Record<string, string> = {}, token = 'operator') => fetch(`http://127.0.0.1:${port}/api/conversations/workspaces/commands?${new URLSearchParams({ connectionId: 'first-page', ...query })}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  /** Feature conversation key of a scene on the first (or second) Sandbox Endpoint, as `feature.*` spells it. */
  const featureKey = (kind: string, id: string, endpoint = 0) => resolveEndpointFeatureKey(createSnapshotView(0, { ...base, projections: projections as never }), String(slots[endpoint]!.id), undefined, { kind, id })!;
  return { db, snapshots, read, save, commands, connections, featureKey, endpointId: String(slots[0]!.id) };
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

  it('offers quick commands from the command index with the endpoint prefix, never hard-coded ones', async () => {
    const slash = await fixture({ commands: { prefix: '/', names: ['ping', { name: 'status', permit: ['owner'] }] } });
    const response = await slash.commands({ type: 'group', id: 'room' });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    // Menu first (its real keyword), then only registered, parameterless, unrestricted commands.
    expect((await response.json()).data).toEqual({ prefix: '/', menu: '/菜单', quick: ['/菜单', '/ping'] });
    expect((await (await slash.commands({ type: 'group', id: 'room', locale: 'en' })).json()).data.quick).toEqual(['/menu', '/ping']);
    // No prefix: no leading slash; a configured menu keyword is used as is; nothing that is not registered.
    const bare = await fixture({ commands: { menuKeyword: '帮助', names: [] } });
    expect((await (await bare.commands()).json()).data).toEqual({ prefix: '', menu: '帮助', quick: ['帮助'] });
    const off = await fixture({ commands: { menuKeyword: false, names: [] } });
    expect((await (await off.commands()).json()).data).toEqual({ prefix: '', quick: [] });
  });

  it('leaves commands with a required parameter out of quick commands', async () => {
    // Declared on the command itself (`params`), as a parameter directory would; a quick command is sent as is.
    const f = await fixture({ commands: { prefix: '/', names: [{ name: 'ping', params: { target: { type: 'string' } } }, 'status'] } });
    expect((await (await f.commands({ type: 'group', id: 'room' })).json()).data).toEqual({ prefix: '/', menu: '/菜单', quick: ['/菜单', '/status'] });
    const optional = await fixture({ commands: { prefix: '/', names: [{ name: 'ping', params: { target: { type: 'string', optional: true } } }] } });
    expect((await (await optional.commands({ type: 'group', id: 'room' })).json()).data.quick).toEqual(['/菜单', '/ping']);
  });

  it('finds quick commands by their stable route, not the localized display name (#1250)', async () => {
    const f = await fixture({ commands: { prefix: '/', names: [{ name: 'ping', alias: ['测试连通'], preferredAliasI18n: { 'zh-CN': '测试连通' } }] } });
    expect((await (await f.commands({ type: 'group', id: 'room' })).json()).data.quick).toEqual(['/菜单', '/测试连通']);
    expect((await (await f.commands({ type: 'group', id: 'room', locale: 'en' })).json()).data.quick).toEqual(['/menu', '/ping']);
    // A command merely displayed as `ping` (another route) is not the everyday `ping`.
    const other = await fixture({ commands: { prefix: '/', names: [{ name: 'pong', alias: ['ping'], preferredAliasI18n: { 'zh-CN': 'ping', en: 'ping' } }] } });
    expect((await (await other.commands({ type: 'group', id: 'room' })).json()).data.quick).toEqual(['/菜单']);
  });

  it('guards quick commands like the directory: credentials, live binding and a valid scene', async () => {
    const f = await fixture({ commands: { names: ['ping'] } });
    expect((await f.commands({}, 'demo')).status).toBe(403);
    expect((await f.commands({ connectionId: 'unknown' })).status).toBe(503);
    for (const query of [{ connectionId: '' }, { type: 'room' }, { id: '' }]) expect((await f.commands(query)).status).toBe(400);
    // Works without the directory store (browser fallback pages still get real commands).
    const absent = await fixture({ unavailable: true, commands: { names: [] } });
    expect((await (await absent.commands()).json()).data.quick).toEqual(['菜单']);
  });

  it('resolves Console-given conversation names for feature keys of the same Endpoint and owner (#1250)', async () => {
    const f = await fixture();
    const group = { ...conversation, id: 'group-6cf34af4', type: 'group', name: '测试群' };
    expect((await f.save({ connectionId: 'first-page', conversation: group, expectedRevision: null })).status).toBe(200);
    const key = f.featureKey('group', 'group-6cf34af4');
    expect(key).toBe('sandbox-one/sandbox/group:group-6cf34af4');
    expect(await readWorkspaceConversationNames(f.db, f.snapshots, [key, f.featureKey('group', 'unknown'), 'not a key'])).toEqual(new Map([[key, '测试群']]));
    // Same kind and id under another Endpoint: not this workspace's conversation.
    expect((await readWorkspaceConversationNames(f.db, f.snapshots, [f.featureKey('group', 'group-6cf34af4', 1)])).size).toBe(0);
    // Same scene, wrong adapter alias or endpoint id in the key: nothing.
    expect((await readWorkspaceConversationNames(f.db, f.snapshots, ['other/sandbox/group:group-6cf34af4', 'sandbox-one/other/group:group-6cf34af4'])).size).toBe(0);
    // Another owner served by the same Endpoint names it differently: ambiguous, no guess.
    expect((await f.save({ connectionId: 'other-owner', conversation: { ...group, name: '另一个名字' }, expectedRevision: null })).status).toBe(200);
    expect((await readWorkspaceConversationNames(f.db, f.snapshots, [key])).size).toBe(0);
    expect((await readWorkspaceConversationNames(undefined, f.snapshots, [key])).size).toBe(0);
    expect((await readWorkspaceConversationNames(f.db, undefined, [key])).size).toBe(0);
  });

  it('never reveals a name stored under an owner the Endpoint no longer serves (#1250)', async () => {
    const f = await fixture();
    const group = { ...conversation, id: 'room-a', type: 'group', name: '甲的会话' };
    expect((await f.save({ connectionId: 'other-owner', conversation: group, expectedRevision: null })).status).toBe(200);
    const key = f.featureKey('group', 'room-a');
    expect(await readWorkspaceConversationNames(f.db, f.snapshots, [key])).toEqual(new Map([[key, '甲的会话']]));
    // The owner's connections are gone (owner reconfigured): its names stay private.
    f.connections.delete('other-owner');
    expect((await readWorkspaceConversationNames(f.db, f.snapshots, [key])).size).toBe(0);
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
