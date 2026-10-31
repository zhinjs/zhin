import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PluginConsoleRpcError, SnapshotStore, childPluginId, definePluginConsoleRpc, pluginConsoleRpcToken, rootPluginId,
  featureId, type PluginConsoleRpcDefinition, type SnapshotState,
} from '@zhin.js/plugin-runtime';
import { publicConsoleAccess, unrestrictedConsoleAccess, type ConsoleAccess } from '@zhin.js/host-http';
import { dispatchPluginConsoleRpcRequest } from '../../../src/plugin-runtime/console/plugin-console-rpc.js';

const scoped = (permissions: string[] = [], roles: string[] = []): ConsoleAccess => ({ unrestricted: false, permissions, roles });
const accessFor = (scope: 'full' | 'demo' | ConsoleAccess): ConsoleAccess =>
  scope === 'full' ? unrestrictedConsoleAccess : scope === 'demo' ? publicConsoleAccess : scope;

const stores: SnapshotStore[] = [];
afterEach(async () => { for (const store of stores.splice(0)) await store.close(); });

const root = rootPluginId(), owner = childPluginId(root, 'ambient'), child = childPluginId(owner, 'nested');

type PageStub = { localName: string; requiredPermissions: readonly string[]; requiredRoles: readonly string[] };

function setup(definition: PluginConsoleRpcDefinition, pages: readonly PageStub[] = [], inheritToChild = false) {
  const rpc = definePluginConsoleRpc(definition);
  const state: SnapshotState = {
    root,
    tree: new Map([
      [root, { id: root, instanceKey: 'root', packageName: 'app', packageRoot: '/app', children: [owner] }],
      [owner, { id: owner, instanceKey: 'ambient', packageName: 'ambient', packageRoot: '/app/ambient', parent: root, children: [child] }],
      [child, { id: child, instanceKey: 'nested', packageName: 'nested', packageRoot: '/app/nested', parent: owner, children: [] }],
    ]),
    config: new Map(), capabilities: new Map(), projections: new Map(),
    resources: new Map([
      [root, new Map()],
      [owner, new Map([[pluginConsoleRpcToken.id, rpc]])],
      [child, new Map(inheritToChild ? [[pluginConsoleRpcToken.id, rpc]] : [])],
    ]),
  };
  const store = new SnapshotStore(state); stores.push(store);
  const pagesOwnedBy = vi.fn((_snapshot: unknown, id: string) => (id === owner ? pages : []) as never);
  const call = (type: string, data?: unknown, scope: 'full' | 'demo' | ConsoleAccess = 'full', timeoutMs?: number) =>
    dispatchPluginConsoleRpcRequest({ type, requestId: 7, ...(data === undefined ? {} : { data }) },
      { snapshots: store, access: accessFor(scope), pagesOwnedBy, ...(timeoutMs === undefined ? {} : { timeoutMs }) });
  return { call, pagesOwnedBy };
}

const status = (extra: Record<string, unknown> = {}) => ({ handler: vi.fn(async () => ({ mode: 'shadow', recent: [{ at: 1, engaged: false }] })), ...extra });

it('ignores types that are not plugin Console RPC so built-in RPC keeps working', async () => {
  const { call } = setup({ status: status() });
  expect(await call('plugin:inspect')).toBeUndefined();
  expect(await call('config:get')).toBeUndefined();
  expect(await call('plugin.root/ambient')).toBeUndefined();
});

it('serves plugin.<pluginId>.status to the full-scope operator with plain JSON only', async () => {
  const handler = vi.fn(async () => ({ count: 2, when: new Date(0), skip: undefined }));
  const { call } = setup({ status: { handler } });
  const reply = await call('plugin.root/ambient.status', { limit: 5 });
  expect(reply).toEqual({ status: 200, body: { success: true, data: { count: 2, when: '1970-01-01T00:00:00.000Z' }, requestId: 7 } });
  expect(handler).toHaveBeenCalledWith({ limit: 5 }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
});

it('dispatches named actions and keeps them full-scope only', async () => {
  const reset = vi.fn(async (input: Record<string, unknown>) => ({ reset: input.target ?? null }));
  const { call } = setup({ status: status({ demo: true }), actions: { 'reset-cooldown': { handler: reset } } });
  expect((await call('plugin.root/ambient.reset-cooldown', { target: 'g1' }))?.body).toMatchObject({ success: true, data: { reset: 'g1' } });
  const denied = await call('plugin.root/ambient.reset-cooldown', {}, 'demo');
  expect(denied).toMatchObject({ status: 403, body: { success: false, code: 'forbidden' } });
  expect(reset).toHaveBeenCalledTimes(1);
});

it('lets demo read status only when the plugin opts in and the bound page has no requirements', async () => {
  expect((await setup({ status: status() }).call('plugin.root/ambient.status', undefined, 'demo'))?.status).toBe(403);
  const open = setup({ status: status({ demo: true, page: 'ambient' }) }, [{ localName: 'ambient', requiredPermissions: [], requiredRoles: [] }]);
  expect((await open.call('plugin.root/ambient.status', undefined, 'demo'))?.status).toBe(200);
  const guarded = setup({ status: status({ demo: true, page: 'ambient' }) }, [{ localName: 'ambient', requiredPermissions: ['ambient:read'], requiredRoles: [] }]);
  expect((await guarded.call('plugin.root/ambient.status', undefined, 'demo'))?.status).toBe(403);
  expect((await guarded.call('plugin.root/ambient.status', undefined, 'full'))?.status).toBe(200);
  const ownRequirement = setup({ status: status({ demo: true, requiredRoles: ['master'] }) });
  expect((await ownRequirement.call('plugin.root/ambient.status', undefined, 'demo'))?.status).toBe(403);
});

it('fails closed when the bound page is not loaded in this generation', async () => {
  const { call } = setup({ status: status({ page: 'missing' }) });
  expect(await call('plugin.root/ambient.status')).toMatchObject({ status: 503, body: { code: 'unavailable' } });
});

it('answers only from the declaring owner, not from inherited child bindings', async () => {
  const { call } = setup({ status: status() }, [], true);
  expect(await call('plugin.root/ambient/nested.status')).toMatchObject({ status: 404, body: { code: 'not_found' } });
  expect(await call('plugin.root/unknown.status')).toMatchObject({ status: 404 });
  expect(await call('plugin.root/ambient.nope')).toMatchObject({ status: 404 });
});

it('rejects non-object input and never leaks raw handler errors', async () => {
  const { call } = setup({
    status: { handler: async () => { throw new Error('secret stack at /home/x token=abc'); } },
    actions: { save: { handler: async () => { throw new PluginConsoleRpcError('conflict', '设置已被修改，请刷新'); } } },
  });
  expect(await call('plugin.root/ambient.status', [1])).toMatchObject({ status: 400, body: { code: 'invalid_input' } });
  const failed = await call('plugin.root/ambient.status');
  expect(failed).toMatchObject({ status: 500, body: { code: 'failed', error: '插件操作失败' } });
  expect(JSON.stringify(failed)).not.toContain('secret');
  expect(await call('plugin.root/ambient.save')).toMatchObject({ status: 409, body: { code: 'conflict', error: '设置已被修改，请刷新' } });
});

it('times out slow handlers and aborts their signal', async () => {
  let signal: AbortSignal | undefined;
  const { call } = setup({ status: { handler: (_input, ctx) => { signal = ctx.signal; return new Promise(() => undefined); } } });
  expect(await call('plugin.root/ambient.status', undefined, 'full', 20)).toMatchObject({ status: 504, body: { code: 'timeout' } });
  expect(signal?.aborted).toBe(true);
});

it('injects only an authenticated narrow operation view and rejects other feature reads', async () => {
  const { call } = setup({ status: { handler: (_input, ctx) => {
    expect(ctx.runtime).toMatchObject({ owner, generation: 0, operator: true });
    expect(Object.keys(ctx.runtime!)).toEqual(['owner', 'generation', 'operator', 'project']);
    expect(ctx.runtime).not.toHaveProperty('snapshot');
    expect(ctx.runtime).not.toHaveProperty('resources');
    expect(ctx.runtime).not.toHaveProperty('config');
    expect(() => ctx.runtime!.project(featureId('ungranted.feature'))).toThrow(PluginConsoleRpcError);
    return { scoped: true };
  } } });
  expect(await call('plugin.root/ambient.status')).toMatchObject({ status: 200, body: { data: { scoped: true } } });
});

it('reports unknown commit only after the internal commit-start boundary, without changing ordinary timeout', async () => {
  const handler = vi.fn((_input, ctx) => { ctx.commitStarted?.(); return new Promise(() => undefined); });
  const { call } = setup({ actions: { save: { handler } } });
  expect(await call('plugin.root/ambient.save', {}, 'full', 20)).toMatchObject({ status: 504, body: { code: 'commit_unknown' } });
  expect(handler).toHaveBeenCalledTimes(1);
});

it('bounds output size so status cannot become a log dump', async () => {
  const { call } = setup({ status: { handler: async () => ({ rows: 'x'.repeat(300 * 1024) }) } });
  expect(await call('plugin.root/ambient.status')).toMatchObject({ status: 500, body: { code: 'failed' } });
});

it('reports an unavailable runtime instead of throwing', async () => {
  expect(await dispatchPluginConsoleRpcRequest({ type: 'plugin.root.status' }, { access: unrestrictedConsoleAccess }))
    .toMatchObject({ status: 503, body: { code: 'unavailable' } });
});

it('lets a scoped token read status when it holds the page permissions and roles', async () => {
  const guarded = setup({ status: status({ page: 'ambient' }), actions: { reset: { page: 'ambient', handler: async () => null } } },
    [{ localName: 'ambient', requiredPermissions: ['ambient:read'], requiredRoles: ['member'] }]);
  expect((await guarded.call('plugin.root/ambient.status', undefined, scoped(['ambient:read'], ['member'])))?.status).toBe(200);
  expect((await guarded.call('plugin.root/ambient.status', undefined, scoped(['ambient:read'])))?.status).toBe(403);
  expect((await guarded.call('plugin.root/ambient.status', undefined, scoped([], ['member'])))?.status).toBe(403);
  // Page requirements alone never open an action: it needs its own permission or role.
  expect((await guarded.call('plugin.root/ambient.reset', {}, scoped(['ambient:read'], ['member'])))?.status).toBe(403);
  expect((await guarded.call('plugin.root/ambient.reset', {}, 'full'))?.status).toBe(200);
});

it('keeps an unguarded status closed to scoped tokens unless the plugin opts in', async () => {
  expect((await setup({ status: status() }).call('plugin.root/ambient.status', undefined, scoped(['x'])))?.status).toBe(403);
  expect((await setup({ status: status({ demo: true }) }).call('plugin.root/ambient.status', undefined, scoped(['x'])))?.status).toBe(200);
});

describe('plugin Console actions for non-admin tokens', () => {
  const save = () => vi.fn(async (input: Record<string, unknown>) => ({ saved: input.group ?? null }));
  const anonymous = publicConsoleAccess;

  it('lets a user token holding the action permission run it', async () => {
    const handler = save();
    const { call } = setup({ status: status(), actions: { 'clear-cooldown': { requiredPermissions: ['ambient:write'], handler } } });
    expect(await call('plugin.root/ambient.clear-cooldown', { group: 'g1' }, scoped(['ambient:write'])))
      .toMatchObject({ status: 200, body: { success: true, data: { saved: 'g1' } } });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('forbids a user token missing the permission or role, and anonymous callers', async () => {
    const handler = save();
    const { call } = setup({ status: status(), actions: { 'clear-cooldown': { requiredPermissions: ['ambient:write'], requiredRoles: ['member'], handler } } });
    const missingRole = await call('plugin.root/ambient.clear-cooldown', {}, scoped(['ambient:write']));
    expect(missingRole).toMatchObject({ status: 403, body: { code: 'forbidden', error: '没有操作权限' } });
    expect(await call('plugin.root/ambient.clear-cooldown', {}, scoped(['ambient:read'], ['member']))).toMatchObject({ status: 403 });
    expect(await call('plugin.root/ambient.clear-cooldown', {}, anonymous)).toMatchObject({ status: 403 });
    expect(await call('plugin.root/ambient.clear-cooldown', {}, scoped(['ambient:write'], ['member']))).toMatchObject({ status: 200 });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('accepts any one of anyOfPermissions on top of requiredPermissions', async () => {
    const handler = save();
    const { call } = setup({ status: status(), actions: { approve: { anyOfPermissions: ['ops:approve', 'legacy:resolve'], handler } } });
    expect(await call('plugin.root/ambient.approve', {}, scoped(['ops:approve']))).toMatchObject({ status: 200 });
    expect(await call('plugin.root/ambient.approve', {}, scoped(['legacy:resolve']))).toMatchObject({ status: 200 });
    expect(await call('plugin.root/ambient.approve', {}, scoped(['control:write']))).toMatchObject({ status: 403 });
    expect(await call('plugin.root/ambient.approve', {}, anonymous)).toMatchObject({ status: 403 });
    const both = setup({ status: status(), actions: { approve: { requiredPermissions: ['ambient:write'], anyOfPermissions: ['ops:approve'], handler } } });
    expect(await both.call('plugin.root/ambient.approve', {}, scoped(['ops:approve']))).toMatchObject({ status: 403 });
    expect(await both.call('plugin.root/ambient.approve', {}, scoped(['ops:approve', 'ambient:write']))).toMatchObject({ status: 200 });
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it('adds the bound page requirements to the action and still lets the admin run it', async () => {
    const handler = save();
    const { call } = setup(
      { status: status(), actions: { reset: { page: 'ambient', requiredPermissions: ['ambient:write'], handler } } },
      [{ localName: 'ambient', requiredPermissions: ['ambient:read'], requiredRoles: [] }],
    );
    expect(await call('plugin.root/ambient.reset', {}, scoped(['ambient:write']))).toMatchObject({ status: 403 });
    expect(await call('plugin.root/ambient.reset', {}, scoped(['ambient:read', 'ambient:write']))).toMatchObject({ status: 200 });
    expect(await call('plugin.root/ambient.reset', {}, 'full')).toMatchObject({ status: 200 });
  });

  it('keeps an action with no requirements of its own admin-only', async () => {
    const { call } = setup({ status: status(), actions: { reset: { handler: save() } } });
    expect(await call('plugin.root/ambient.reset', {}, scoped(['anything'], ['member'])))
      .toMatchObject({ status: 403, body: { code: 'forbidden', error: '需要管理员令牌' } });
    expect(await call('plugin.root/ambient.reset', {}, 'full')).toMatchObject({ status: 200 });
  });
});

it('serves host-owned queries as plugin.root.<name> ahead of a root plugin provider, read-only for scoped tokens', async () => {
  const root = rootPluginId();
  const rootRpc = definePluginConsoleRpc({ status: { handler: async () => ({ from: 'root-plugin' }) }, queries: { ambient: { handler: async () => ({ from: 'root-plugin' }) } } });
  const state: SnapshotState = {
    root,
    tree: new Map([[root, { id: root, instanceKey: 'root', packageName: 'app', packageRoot: '/app', children: [] }]]),
    config: new Map(), capabilities: new Map(), projections: new Map(),
    resources: new Map([[root, new Map([[pluginConsoleRpcToken.id, rootRpc]])]]),
  };
  const store = new SnapshotStore(state); stores.push(store);
  const hostRpc = definePluginConsoleRpc({
    queries: { ambient: { requiredPermissions: ['ambient:read'], handler: async () => ({ from: 'host' }) } },
    actions: { reset: { handler: async () => null } },
  });
  const call = (type: string, access: ConsoleAccess) => dispatchPluginConsoleRpcRequest({ type, requestId: 1 },
    { snapshots: store, access, pagesOwnedBy: () => [] as never, hostRpc: () => hostRpc });
  expect(await call('plugin.root.ambient', scoped(['ambient:read']))).toMatchObject({ status: 200, body: { data: { from: 'host' } } });
  expect(await call('plugin.root.ambient', scoped())).toMatchObject({ status: 403 });
  expect(await call('plugin.root.reset', scoped(['ambient:read']))).toMatchObject({ status: 403 });
  expect(await call('plugin.root.status', unrestrictedConsoleAccess)).toMatchObject({ status: 200, body: { data: { from: 'root-plugin' } } });
});
