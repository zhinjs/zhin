import { afterEach, expect, it, vi } from 'vitest';
import {
  PluginConsoleRpcError, SnapshotStore, childPluginId, definePluginConsoleRpc, pluginConsoleRpcToken, rootPluginId,
  type PluginConsoleRpcDefinition, type SnapshotState,
} from '@zhin.js/plugin-runtime';
import { dispatchPluginConsoleRpcRequest } from '../../../src/plugin-runtime/console/plugin-console-rpc.js';

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
  const call = (type: string, data?: unknown, authScope: 'full' | 'demo' = 'full', timeoutMs?: number) =>
    dispatchPluginConsoleRpcRequest({ type, requestId: 7, ...(data === undefined ? {} : { data }) },
      { snapshots: store, authScope, pagesOwnedBy, ...(timeoutMs === undefined ? {} : { timeoutMs }) });
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

it('bounds output size so status cannot become a log dump', async () => {
  const { call } = setup({ status: { handler: async () => ({ rows: 'x'.repeat(300 * 1024) }) } });
  expect(await call('plugin.root/ambient.status')).toMatchObject({ status: 500, body: { code: 'failed' } });
});

it('reports an unavailable runtime instead of throwing', async () => {
  expect(await dispatchPluginConsoleRpcRequest({ type: 'plugin.root.status' }, { authScope: 'full' }))
    .toMatchObject({ status: 503, body: { code: 'unavailable' } });
});
