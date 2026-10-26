import { createHttpHost, type HttpHost } from '@zhin.js/host-http';
import { adapterFeatureId } from '@zhin.js/adapter';
import {
  SnapshotStore, createGenerationAdmissionGate, generationAdmissionSource, pluginTaskProviderToken,
  PluginTaskError, rootPluginId, childPluginId,
  type PluginTaskProvider, type PluginTaskSnapshot, type SnapshotState,
} from '@zhin.js/plugin-runtime';
import { registerPluginTaskRoutes } from '../../../src/plugin-runtime/console/plugin-task-routes.js';

const hosts: HttpHost[] = [];
const stores: SnapshotStore[] = [];
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.close();
  for (const store of stores.splice(0)) await store.close();
});
const root = rootPluginId(), owner = childPluginId(root, 'reminder'), child = childPluginId(owner, 'nested');
const target = { endpoint: { id: 'root/telegram\0zhin.adapter\0bot', adapter: 'telegram' }, kind: 'channel' as const,
  id: 'room', parent: { kind: 'channel' as const, id: 'workspace' }, threadId: 'topic' };
const requestId = '550e8400-e29b-41d4-a716-446655440000';
const parameters = { text: 'business content', at: '2027-01-01T09:00:00+08:00' };
const book: PluginTaskSnapshot = { revision: 'r1', receipts: [], tasks: [{ id: 'task-1', ownership: 'administrator',
  title: 'Reminder', target, state: 'scheduled', createdAt: 1, nextRunAt: 2, parameters, actions: ['pause', 'cancel', 'update'] }] };

function setup(options: { missingProvider?: boolean; outbound?: boolean; read?: PluginTaskProvider['read']; create?: PluginTaskProvider['create']; change?: PluginTaskProvider['change'] } = {}) {
  const gate = createGenerationAdmissionGate();
  const provider: PluginTaskProvider = {
    [generationAdmissionSource]: [gate], title: 'Administrator reminders', description: 'Independent from chat tasks',
    schema: { type: 'object' }, effects: ['Sends at the configured time'],
    read: vi.fn(options.read ?? (async () => book)),
    create: vi.fn(options.create ?? (async () => book)), change: vi.fn(options.change ?? (async () => book)),
  };
  const send = vi.fn(), probe = vi.fn();
  const adapters = { $projection: 'zhin.adapter-index/1', list: () => [{ id: target.endpoint.id }],
    clientAdapter: () => target.endpoint.adapter, capabilities: () => ({ inbound: true, outbound: options.outbound !== false }), send, probe };
  const state: SnapshotState = {
    root, tree: new Map([
      [root, { id: root, instanceKey: 'root', packageName: 'app', packageRoot: '/app', children: [owner] }],
      [owner, { id: owner, instanceKey: 'reminder', packageName: '@zhin.js/plugin-reminder', packageRoot: '/app/reminder', parent: root, children: [child] }],
      [child, { id: child, instanceKey: 'nested', packageName: 'nested', packageRoot: '/app/reminder/nested', parent: owner, children: [] }],
    ]), config: new Map(), capabilities: new Map(), projections: new Map([[adapterFeatureId, adapters]]),
    resources: new Map([[root, new Map()],
      [owner, new Map(options.missingProvider ? [] : [[pluginTaskProviderToken.id, provider]])],
      [child, new Map(options.missingProvider ? [] : [[pluginTaskProviderToken.id, provider]])]]),
  };
  const store = new SnapshotStore(state); stores.push(store);
  return { state, store, gate, provider, send, probe };
}
async function start(fixture?: ReturnType<typeof setup>) {
  const http = createHttpHost({ host: '127.0.0.1', port: 0, token: 'operator', tokens: [{ token: 'demo', scope: 'demo' }] });
  hosts.push(http); registerPluginTaskRoutes({ http, base: '/api', snapshots: fixture?.store });
  const { port } = await http.listen();
  return (path = '/providers', body?: unknown, token = 'operator') => fetch(`http://127.0.0.1:${port}/api/tasks${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
}
const create = (extra: Record<string, unknown> = {}) => ({ generation: 0, owner, requestId, expectedRevision: 'r1', target, parameters, ...extra });
const change = (extra: Record<string, unknown> = {}) => ({ generation: 0, owner, requestId, expectedRevision: 'r1', id: 'task-1', action: 'cancel', ...extra });

it('lists only the provider declaration owner with exact target, package and bounded mutation receipts', async () => {
  const f = setup(); const request = await start(f); const response = await request();
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  const body = await response.json();
  expect(body.data).toMatchObject({ generation: 0, providers: [{ owner, packageName: '@zhin.js/plugin-reminder', revision: 'r1', tasks: book.tasks, receipts: [] }] });
  expect(body.data.providers).toHaveLength(1);
  expect(f.provider.read).toHaveBeenCalledTimes(1); expect(f.send).not.toHaveBeenCalled(); expect(f.probe).not.toHaveBeenCalled();
});

it('passes an explicit display locale while keeping task identifiers and revisions intact', async () => {
  const f = setup(); const request = await start(f);
  Object.assign(f.provider, { i18n: { en: { title: 'English task title', description: 'English description', effects: ['English effect'] } } });
  const response = await request('/providers?locale=en');
  expect(response.status).toBe(200);
  expect(f.provider.read).toHaveBeenCalledExactlyOnceWith({ locale: 'en' });
  expect((await response.json()).data.providers[0]).toMatchObject({ title: 'English task title', description: 'English description',
    effects: ['English effect'], revision: 'r1', tasks: book.tasks });
  expect((await request('/create', create({ locale: 'en' }))).status).toBe(200);
  expect(f.provider.create).toHaveBeenCalledExactlyOnceWith({ requestId, expectedRevision: 'r1', target, parameters, locale: 'en' });
  const useCases = await request('/use-cases?locale=en');
  expect((await useCases.json()).data.find((item: { id: string }) => item.id === 'reminder').title).toBe('Create a scheduled reminder');
  for (const path of ['/providers?locale=de', '/providers?locale=en&locale=zh-CN', '/use-cases?locale=de']) {
    expect((await request(path)).status).toBe(400);
  }
  expect((await request('/create', create({ locale: 'de' }))).status).toBe(400);
});

it('distinguishes an unloaded provider from an unavailable runtime and provides static use cases without a runtime', async () => {
  const empty = await start(setup({ missingProvider: true }));
  expect((await (await empty()).json()).data.providers).toEqual([]);
  const unavailable = await start(); expect((await unavailable()).status).toBe(503);
  const useCases = await unavailable('/use-cases'); expect(useCases.status).toBe(200);
  expect((await useCases.json()).data.some((item: { id: string }) => item.id === 'reminder')).toBe(true);
});

it('forwards validated create commands to the exact owner without pre-reading, sending or probing', async () => {
  const f = setup(); const request = await start(f);
  const response = await request('/create', create()); expect(response.status).toBe(200);
  expect(f.provider.create).toHaveBeenCalledExactlyOnceWith({ requestId, expectedRevision: 'r1', target, parameters });
  expect((await response.json()).data).toMatchObject({ generation: 0, provider: { owner, packageName: '@zhin.js/plugin-reminder', revision: 'r1' } });
  expect(f.provider.read).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
});

it('delegates repeated cancellation reconciliation directly to the provider even when the task is already absent', async () => {
  const result = { revision: 'r2', tasks: [], receipts: [{ requestId, taskId: 'task-1', operation: 'cancel' as const }] };
  const f = setup({ change: async () => result }); const request = await start(f);
  const response = await request('/change', change()); expect(response.status).toBe(200);
  expect(f.provider.change).toHaveBeenCalledExactlyOnceWith({ requestId, expectedRevision: 'r1', id: 'task-1', action: 'cancel' });
  expect(f.provider.read).not.toHaveBeenCalled(); expect((await response.json()).data.provider.receipts).toEqual(result.receipts);
});

it.each([
  { generation: -1 }, { generation: 0.1 }, { requestId: 'not-a-uuid' }, { requestId: '550e8400-e29b-11d4-a716-446655440000' },
  { expectedRevision: '' }, { expectedRevision: '\0secret' }, { parameters: [] }, { extra: 'unknown' },
  { target: { ...target, endpoint: { id: target.endpoint.id } } },
  { target: { ...target, endpoint: { ...target.endpoint, adapter: 'slack' } } },
  { target: { ...target, endpoint: { ...target.endpoint, accountId: 'unsafe' } } },
])('rejects malformed or ambiguous create input without invoking provider: %j', async extra => {
  const f = setup(); const request = await start(f); expect((await request('/create', create(extra))).status).toBe(400);
  expect(f.provider.create).not.toHaveBeenCalled();
});

it('rejects missing or inbound-only endpoints, stale generations and inherited-owner aliases', async () => {
  const f = setup(); const request = await start(f);
  expect((await request('/create', create({ target: { ...target, endpoint: { ...target.endpoint, id: 'bare-account' } } }))).status).toBe(404);
  expect((await request('/create', create({ generation: 1 }))).status).toBe(409);
  expect((await request('/create', create({ owner: child }))).status).toBe(404);
  const inboundOnly = await start(setup({ outbound: false })); expect((await inboundOnly('/create', create())).status).toBe(400);
  expect(f.provider.create).not.toHaveBeenCalled();
});

it.each(['invalid_input', 'conflict', 'not_found', 'unsupported', 'unavailable'] as const)('maps provider %s and preserves safe actionable business text', async code => {
  const f = setup({ create: async () => { throw new PluginTaskError(code, '请先编辑为未来时间再恢复'); } }); const request = await start(f);
  const response = await request('/create', create());
  expect(response.status).toBe({ invalid_input: 400, conflict: 409, not_found: 404, unsupported: 400, unavailable: 503 }[code]);
  expect((await response.json()).error).toBe('请先编辑为未来时间再恢复');
});

it.each(['', 'x'.repeat(1001), 'unsafe\nstack', 'unsafe\0secret', 'unsafe\u0085secret', '\nunsafe'])('does not expose an invalid provider business message', async message => {
  const f = setup({ create: async () => { throw new PluginTaskError('invalid_input', message); } }); const request = await start(f);
  const response = await request('/create', create()); expect(response.status).toBe(400);
  expect((await response.json()).error).toBe('任务参数无效，请核对字段与目标');
});

it('makes provider read failure explicit and sanitizes unknown exceptions and invalid output', async () => {
  const failed = await start(setup({ read: async () => { throw new Error('SECRET'); } }));
  const response = await failed(); expect(response.status).toBe(500); expect(await response.text()).not.toContain('SECRET');
  const invalid = await start(setup({ read: async () => ({ ...book, tasks: Array(501).fill(book.tasks[0]) }) }));
  expect((await invalid()).status).toBe(503);
});

it('requires authenticated full scope before reading or mutating provider services', async () => {
  const f = setup(); const request = await start(f);
  expect((await request('/providers', undefined, 'demo')).status).toBe(403);
  expect((await request('/create', create(), 'demo')).status).toBe(403);
  expect((await request('/providers', undefined, 'invalid')).status).toBe(401);
  expect(f.provider.read).not.toHaveBeenCalled(); expect(f.provider.create).not.toHaveBeenCalled();
});

it('does not treat a tokenless Host default full scope as administrator authentication', async () => {
  const f = setup();
  const http = createHttpHost({ host: '127.0.0.1', port: 0 }); hosts.push(http);
  registerPluginTaskRoutes({ http, base: '/api', snapshots: f.store });
  const { port } = await http.listen();
  for (const path of ['providers', 'use-cases']) expect((await fetch(`http://127.0.0.1:${port}/api/tasks/${path}`)).status).toBe(401);
  expect((await fetch(`http://127.0.0.1:${port}/api/tasks/create`, { method: 'POST', body: JSON.stringify(create()) })).status).toBe(401);
  expect(f.provider.read).not.toHaveBeenCalled(); expect(f.provider.create).not.toHaveBeenCalled();
});

it('bounds request bytes, rejects malformed JSON and restricts change-specific fields', async () => {
  const f = setup(); const request = await start(f);
  expect((await request('/create', 'x'.repeat(65537))).status).toBe(413);
  expect((await request('/create', '{')).status).toBe(400);
  expect((await request('/change', change({ target }))).status).toBe(400);
  expect((await request('/change', change({ action: 'pause', parameters }))).status).toBe(400);
  expect(f.provider.create).not.toHaveBeenCalled(); expect(f.provider.change).not.toHaveBeenCalled();
});

it('keeps an admitted operation alive through HMR and rejects subsequent stale requests', async () => {
  let entered!: () => void, finish!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const f = setup({ create: async () => { entered(); await gate; return book; } });
  const disposed = vi.fn();
  f.store.commit(0, { snapshot: f.state, dispose: disposed });
  const request = await start(f); const pending = request('/create', create({ generation: 1 })); await started;
  const next = { ...f.state, resources: new Map([[root, new Map()]]) };
  f.store.commit(1, { snapshot: next, dispose: () => undefined });
  expect(f.gate.active).toBe(false);
  await Promise.resolve(); expect(disposed).not.toHaveBeenCalled();
  expect((await request('/create', create({ generation: 1 }))).status).toBe(409);
  finish(); expect((await pending).status).toBe(200);
  expect(f.provider.create).toHaveBeenCalledTimes(1);
  await vi.waitFor(() => expect(disposed).toHaveBeenCalledTimes(1));
});

it('localizes host failures while keeping the original status and machine code', async () => {
  const f = setup(); const request = await start(f);
  const response = await request('/create', create({ locale: 'en', generation: 42 }));
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ success: false, code: 'conflict', error: 'The generation or task revision changed. Refresh and reconcile before retrying.' });
  expect(f.provider.create).not.toHaveBeenCalled();
  const unavailable = await start();
  expect(await (await unavailable('/providers?locale=en')).json()).toMatchObject({ code: 'unavailable', error: 'The task service is not ready or returned invalid data.' });
});
