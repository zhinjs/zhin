import { AdapterIndex, Endpoint, adapterFeatureId, defineAdapter, endpointEventGatewayToken } from '@zhin.js/adapter';
import { CommandIndex, commandFeatureId, defineCommand } from '@zhin.js/command';
import { ImRuntime } from '@zhin.js/core/runtime';
import { createHttpHost, type HttpHost } from '@zhin.js/host-http';
import { PermissionHost, permissionHostToken } from '@zhin.js/permission';
import { SnapshotStore, childPluginId, createCapabilitySlot, createSnapshotView, rootPluginId, type FeatureId, type SnapshotState } from '@zhin.js/plugin-runtime';
import { registerPermissionExplanationRoutes } from '../../../src/plugin-runtime/console/permission-explanation-routes.js';

declare module '@zhin.js/feature-kit' {
  interface AdapterClientRegistry {
    readonly 'permission-test': { readonly client: object; readonly events: Record<string, unknown> };
  }
}

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

/** Real EndpointRuntime identity + CommandIndex + PermissionHost + authenticated HTTP; no platform I/O. */
async function fixture(options: { host?: 'missing' | 'unverified'; empty?: boolean; count?: number } = {}) {
  const root = rootPluginId(), owner = childPluginId(root, 'adapter-owner');
  const execute = vi.fn(), factory = vi.fn(() => 'private-value'), validate = vi.fn(() => true), checker = vi.fn(() => { throw new Error('CHECKER-SECRET'); });
  const host = new PermissionHost(); host.registerPlatform('permission-test', checker); host.register(/^custom\./, checker);
  const send = vi.fn(() => 'platform-id'), connect = vi.fn(), clientGetter = vi.fn(() => ({}));
  class TestEndpoint extends Endpoint<object> {
    get client() { return clientGetter(); }
    start() { connect(); } open() {} close() {} stop() {}
    send() { return send(); }
  }
  const adapter = createCapabilitySlot({ owner, feature: adapterFeatureId, localName: 'permission-test', source: '/private/adapter.ts',
    definition: defineAdapter({ capabilities: ['inbound', 'outbound'], create: () => new TestEndpoint() }) });
  const definitions = [
    ['admin', defineCommand({ adapter: 'permission-test', description: '仅群聊管理员', descriptionI18n: { en: 'Group administrators only' }, permit: ['group()', 'role(admin)'],
      params: { text: { type: 'string', default: factory, validate } }, execute })],
    ['platform', defineCommand({ permit: ['platform(permission-test,admin)'], execute })],
    ['open', defineCommand({ execute })],
    ['user', defineCommand({ permit: ['user(alice)', 'role(user)'], execute })],
    ...Array.from({ length: options.count ?? 0 }, (_, i) => [`extra-${i}`, defineCommand({ execute })] as const),
  ] as const;
  const commands = options.empty ? [] : definitions.map(([localName, definition]) => createCapabilitySlot({ owner: root,
    feature: commandFeatureId, localName, source: `/private/commands/${localName}/index.ts`, definition }));
  const permissionValue = options.host === 'missing' ? undefined : options.host === 'unverified' ? { check: checker, checkAll: checker } : host;
  const gateway = { receive: async () => undefined };
  const base: SnapshotState = { root, tree: new Map([
    [root, { id: root, instanceKey: 'root', packageName: 'app', packageRoot: '/private', children: [owner] }],
    [owner, { id: owner, instanceKey: 'adapter-owner', packageName: 'adapter-package', packageRoot: '/private/adapter', parent: root, children: [] }],
  ]), config: new Map(), resources: new Map([
    [root, new Map(permissionValue === undefined ? [] : [[permissionHostToken.id, permissionValue]])],
    [owner, new Map([[endpointEventGatewayToken.id, gateway]])],
  ]), capabilities: new Map([adapter, ...commands].map(slot => [slot.id, slot])), projections: new Map() };
  const snapshot = createSnapshotView(0, base);
  const adapters = await AdapterIndex.create([adapter], snapshot, new AbortController().signal);
  const index = new CommandIndex(commands, snapshot);
  const projections = new Map<FeatureId, unknown>([[adapterFeatureId, adapters], [commandFeatureId, index]]);
  const store = new SnapshotStore({ ...base, projections }); const im = new ImRuntime(); im.attach(store);
  const actualEndpoint = im.endpoints.list()[0]!.endpoint;
  const target = { endpoint: actualEndpoint, kind: 'channel' as const, id: 'room', parent: { kind: 'channel' as const, id: 'workspace' }, threadId: 'topic' };
  const group = { ...target, kind: 'group' as const };
  const http = createHttpHost({ host: '127.0.0.1', port: 0, token: 'operator', tokens: [{ token: 'demo', scope: 'demo' }] });
  registerPermissionExplanationRoutes({ http, base: '/api', snapshots: store }); const { port } = await http.listen();
  cleanups.push(async () => { await http.close(); await store.close(); await adapters.stop(); });
  const request = (path = '', input?: unknown, token = 'operator') => fetch(`http://127.0.0.1:${port}/api/commands/permissions${path}`, {
    method: input === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(input === undefined ? {} : { body: typeof input === 'string' ? input : JSON.stringify(input) }),
  });
  const commandId = (name: string) => commands.find(slot => slot.localName === name)!.id;
  const explain = (extra: Record<string, unknown> = {}) => request('/explain', { generation: 0, commandId: commandId('admin'), target: group, sender: { id: 'alice', roles: ['admin'] }, ...extra });
  return { store, base, projections, adapters, adapterId: adapter.id, target, group, request, explain, commandId, execute, factory, validate, checker, send, connect, clientGetter };
}

function expectNoExecution(f: Awaited<ReturnType<typeof fixture>>) {
  for (const spy of [f.execute, f.factory, f.validate, f.checker, f.send, f.connect, f.clientGetter]) expect(spy).not.toHaveBeenCalled();
}

it('lists stable authority metadata with pagination/search and no filesystem paths or dynamic defaults', async () => {
  const f = await fixture({ count: 103 });
  const response = await f.request('?page=2&pageSize=100'); expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const body = await response.json(); expect(body.data).toMatchObject({ generation: 0, page: 2, pageSize: 100, total: 107 });
  expect(body.data.commands).toHaveLength(7); expect(JSON.stringify(body)).not.toContain('/private');
  const search = await (await f.request('?q=管理员')).json(); expect(search.data.commands).toEqual([
    { id: f.commandId('admin'), owner: rootPluginId(), name: 'admin', description: '仅群聊管理员', adapter: 'permission-test', permits: ['group()', 'role(admin)'] },
  ]);
  expectNoExecution(f);
});

it('roundtrips actual EndpointRuntime canonical identity and compares the separate exact adapter gate without I/O', async () => {
  const f = await fixture(); expect(f.target.endpoint.adapter).toBe('permission-test');
  expect(f.target.endpoint.id).toBe(f.adapterId);
  expect(f.target.endpoint.adapter).not.toBe(f.adapters.owner(f.adapterId));
  const response = await f.explain(); expect(response.status).toBe(200); const envelope = await response.json();
  expect(envelope.data).toMatchObject({ generation: 0, simulation: true, permissionHost: 'present', target: f.group, sender: { id: 'alice', roles: ['admin'] },
    adapter: { outcome: 'match' }, rules: [{ kind: 'group', outcome: 'match' }, { kind: 'role', outcome: 'match' }], summary: { outcome: 'match' } });
  expect(envelope.data.unconstrained[0]).toContain('parent 或 thread');
  const differentTopic = { ...f.group, threadId: 'other-topic' };
  expect((await (await f.explain({ target: differentTopic })).json()).data.target).toEqual(differentTopic);
  expectNoExecution(f);
});

it('distinguishes omitted roles, explicit empty roles, sender-only assumptions and no input', async () => {
  const f = await fixture();
  const unknown = (await (await f.explain({ sender: { id: 'alice' } })).json()).data;
  expect(unknown.rules[1].outcome).toBe('unknown'); expect(unknown.summary.outcome).toBe('unknown');
  const empty = (await (await f.explain({ commandId: f.commandId('user'), sender: { id: 'alice', roles: [] } })).json()).data;
  expect(empty.rules.map((row: { outcome: string }) => row.outcome)).toEqual(['match', 'match']);
  expect(empty.assumptions.join()).toContain('默认 user');
  const senderOnly = (await (await f.explain({ commandId: f.commandId('user'), target: undefined, sender: { id: 'alice', roles: [] } })).json()).data;
  expect(senderOnly.rules.map((row: { outcome: string }) => row.outcome)).toEqual(['match', 'match']); expect(senderOnly.target).toBeUndefined();
  const none = (await (await f.explain({ target: undefined, sender: undefined })).json()).data;
  expect(none.adapter.outcome).toBe('unknown'); expect(none.rules.every((row: { outcome: string }) => row.outcome === 'unknown')).toBe(true);
  expectNoExecution(f);
});

it('keeps platform conditions unevaluated, empty permits non-authorizing and host state visible', async () => {
  const f = await fixture();
  const platform = (await (await f.explain({ commandId: f.commandId('platform') })).json()).data;
  expect(platform.rules[0]).toMatchObject({ kind: 'platform', outcome: 'not_evaluated' }); expect(platform.summary.outcome).toBe('not_evaluated');
  expect((await (await f.explain({ commandId: f.commandId('open') })).json()).data.summary.outcome).toBe('not_evaluated');
  for (const host of ['missing', 'unverified'] as const) {
    const absent = await fixture({ host }); const data = (await (await absent.explain()).json()).data;
    expect(data.permissionHost).toBe(host); expect(data.summary.outcome).toBe('unknown'); expectNoExecution(absent);
  }
  expectNoExecution(f);
});

it.each([
  '?page=0', '?page=-1', '?page=1.2', '?pageSize=101', '?pageSize=0', '?page=1&page=2', '?q=x&q=y', '?extra=yes', `?q=${'x'.repeat(201)}`,
])('rejects malformed catalog query %s', async query => {
  const f = await fixture(); expect((await f.request(query)).status).toBe(400); expectNoExecution(f);
});

it.each([
  { generation: -1 }, { generation: 0.5 }, { commandId: '' }, { extra: true }, { rolesKnown: true },
  { sender: { id: 'alice', role: ['admin'] } }, { sender: { id: 'alice', roles: 'admin' } }, { sender: { id: 'alice', roles: Array(101).fill('admin') } },
  { target: { kind: 'group', id: 'room' } }, { target: { endpoint: { adapter: 'permission-test', id: 'bot', accountId: 'unsafe' }, kind: 'group', id: 'room' } },
])('rejects malformed explanation input %j', async extra => {
  const f = await fixture(); expect((await f.explain(extra)).status).toBe(400); expectNoExecution(f);
});

it('rejects stale generation, absent command, endpoint aliases and false adapter/owner claims', async () => {
  const f = await fixture(); expect((await f.explain({ generation: 1 })).status).toBe(409);
  expect((await f.explain({ commandId: 'absent' })).status).toBe(404);
  expect((await f.explain({ target: { ...f.group, endpoint: { ...f.group.endpoint, id: 'bare-account' } } })).status).toBe(404);
  expect((await f.explain({ target: { ...f.group, endpoint: { ...f.group.endpoint, adapter: 'root/adapter-owner' } } })).status).toBe(400);
  expect((await f.explain({ target: { ...f.group, endpoint: { ...f.group.endpoint, adapter: 'slack' } } })).status).toBe(400);
  f.store.commit(0, { snapshot: { ...f.base, projections: f.projections }, dispose: () => undefined });
  expect((await f.explain()).status).toBe(409); expectNoExecution(f);
});

it('distinguishes ready empty command catalog from unavailable runtime/index', async () => {
  const f = await fixture({ empty: true }); expect((await (await f.request()).json()).data).toMatchObject({ commands: [], total: 0 });
  const http = createHttpHost({ host: '127.0.0.1', port: 0, token: 'operator' }); registerPermissionExplanationRoutes({ http, base: '/api' });
  const { port } = await http.listen(); cleanups.push(() => http.close());
  expect((await fetch(`http://127.0.0.1:${port}/api/commands/permissions`, { headers: { authorization: 'Bearer operator' } })).status).toBe(503);
  f.store.commit(0, { snapshot: { ...f.base, projections: new Map() }, dispose: () => undefined });
  expect((await f.request()).status).toBe(503);
});

it('requires explicit authenticated full scope, even when the Host otherwise defaults to tokenless full', async () => {
  const f = await fixture();
  for (const token of ['demo', '', 'invalid']) {
    const response = await f.request('', undefined, token); expect(response.status).toBe(token === 'demo' ? 403 : 401);
    // HttpHost can reject credentials/scopes before the route executes.
    expect((await f.request('/explain', {}, token)).status).toBe(token === 'demo' ? 403 : 401);
  }
  const http: HttpHost = createHttpHost({ host: '127.0.0.1', port: 0 }); registerPermissionExplanationRoutes({ http, base: '/api', snapshots: f.store });
  const { port } = await http.listen(); cleanups.push(() => http.close());
  expect((await fetch(`http://127.0.0.1:${port}/api/commands/permissions`)).status).toBe(401);
  expect((await fetch(`http://127.0.0.1:${port}/api/commands/permissions/explain`, { method: 'POST', body: '{}' })).status).toBe(401);
  expectNoExecution(f);
});

it('rejects bad or oversized JSON before reading runtime and sanitizes arbitrary index errors', async () => {
  const f = await fixture(); expect((await f.request('/explain', '{')).status).toBe(400);
  expect((await f.request('/explain', JSON.stringify({ large: 'x'.repeat(40_000) }))).status).toBe(413);
  const failing = { $projection: 'zhin.command-index/1', list() { throw new Error('PRIVATE-STACK-TOKEN'); } };
  f.store.commit(0, { snapshot: { ...f.base, projections: new Map([[commandFeatureId, failing]]) }, dispose: () => undefined });
  const response = await f.request(); expect(response.status).toBe(500); expect(await response.text()).not.toContain('PRIVATE-STACK-TOKEN'); expectNoExecution(f);
});

it('localizes authority explanations without changing identity or invoking checks', async () => {
  const f = await fixture();
  const listing = await (await f.request('?locale=en')).json();
  expect(listing.data.commands.find((item: { id: string }) => item.id === f.commandId('admin')).description).toBe('Group administrators only');
  const result = await f.request('/explain?locale=en', { generation: 0, commandId: f.commandId('admin'), target: f.group, sender: { id: 'alice', roles: ['admin'] } });
  const body = await result.json();
  expect(body.data.target).toEqual(f.group);
  expect(body.data.summary.outcome).toBe('match');
  expect(JSON.stringify(body.data)).not.toMatch(/[\p{Script=Han}]/u);
  const stale = await f.request('/explain?locale=en', { generation: 1, commandId: f.commandId('admin') });
  expect(stale.status).toBe(409); expect((await stale.json()).error).toContain('generation changed');
  expect((await f.request('?locale=en&locale=zh-CN')).status).toBe(400);
  expect((await f.request('/explain?locale=de', { generation: 0, commandId: f.commandId('admin') })).status).toBe(400);
  expectNoExecution(f);
});
