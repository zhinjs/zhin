import { describe, expect, it, vi } from 'vitest';
import {
  applyConfigPatches, childPluginId, createCapabilitySlot, featureId, rootPluginId,
  type PluginId, type RuntimeConfigDocument, type RuntimeSnapshot,
} from '@zhin.js/plugin-runtime';
import type { ConsoleConfigPatchRequest, ConsoleConfigPatchResult } from '@zhin.js/console-protocol';
import {
  dispatchFeatureConsoleRpc, type FeatureRpcContext,
} from '../../../src/plugin-runtime/console/console-feature-rpc.js';

const root = rootPluginId();
const rss = childPluginId(root, 'rss');
const qq = childPluginId(root, 'qq');
const tg = childPluginId(root, 'tg');
const plain = childPluginId(root, 'plain');

const rssSchema = {
  type: 'object', additionalProperties: false,
  'x-zhin-config': { levels: ['global', 'adapter', 'endpoint'] },
  properties: {
    commandNamespace: { type: 'string' }, disabledCommands: { type: 'array' }, overrides: { type: 'object' },
    maxItems: { type: 'integer', minimum: 1 },
    apiKey: { type: 'string', writeOnly: true, 'x-zhin-config': { levels: ['global'], secret: true } },
    style: { type: 'object', properties: { title: { type: 'string' }, token: { type: 'string', 'x-zhin-config': { secret: true } } } },
  },
};

function snapshot(): RuntimeSnapshot {
  const node = (id: PluginId, instanceKey: string, configSchema?: object, displayName?: string) => ({
    id, instanceKey, packageName: `@x/${instanceKey}`, packageRoot: `/x/${instanceKey}`, parent: id === root ? undefined : root,
    children: [], ...(configSchema ? { configSchema } : {}), ...(displayName ? { metadata: { displayName } } : {}),
  });
  const adapter = (owner: PluginId) => createCapabilitySlot({ owner, feature: featureId('zhin.adapter'), localName: 'main', source: '/a.ts', definition: {} });
  return {
    generation: 1, root,
    tree: new Map([[root, node(root, 'root')], [rss, node(rss, 'rss', rssSchema, 'RSS 订阅')], [qq, node(qq, 'qq')], [tg, node(tg, 'tg')],
      [plain, node(plain, 'plain', { type: 'object', properties: { commandNamespace: { type: 'string' }, overrides: { type: 'object' } } })]]) as never,
    config: new Map(), resources: new Map(), projections: new Map(),
    capabilities: new Map([adapter(qq), adapter(tg)].map(slot => [slot.id, slot])),
  };
}

function harness(document: RuntimeConfigDocument, options: Partial<FeatureRpcContext> = {}) {
  const state = { document: structuredClone(document), revision: 1 };
  const patches: ConsoleConfigPatchRequest[] = [];
  const configuration = {
    async readProject() { return { revision: `r${state.revision}`, exists: true, value: structuredClone(state.document) }; },
    async patch(request: ConsoleConfigPatchRequest): Promise<ConsoleConfigPatchResult> {
      patches.push(request);
      if (request.expectedRevision !== `r${state.revision}`) return { status: 'conflict', revision: `r${state.revision}`, current: [], message: 'conflict' };
      state.document = applyConfigPatches(state.document, request.patches as never);
      state.revision += 1;
      return { status: 'saved', revision: `r${state.revision}`, restartRequired: false, paths: request.patches.map(patch => patch.path), missingEnv: [], message: '配置已保存' };
    },
  };
  const snap = snapshot();
  const context: FeatureRpcContext = {
    authScope: 'full', authorize: () => true, configuration, snapshots: { acquire: () => ({ value: snap, release() {} }) as never }, ...options,
  };
  const call = async (type: string, data: Record<string, unknown> = {}) => dispatchFeatureConsoleRpc({ type, data, requestId: 7 }, context);
  return { state, patches, call, context };
}

const base = {
  configVersion: 2, plugins: { rss: '@x/rss', qq: '@x/qq', tg: '@x/tg', plain: '@x/plain' }, disable_plugins: ['plain'],
  qq: { endpoints: [{ id: 'bot-1' }, { id: 'bot-2' }] },
  rss: { maxItems: 5, apiKey: '${RSS_KEY}', style: { title: 'T', token: 'secret-token' },
    overrides: { adapters: { qq: { enabled: false, maxItems: 3 } }, endpoints: { 'tg/news': { maxItems: 1 } } } },
};

describe('feature.* Console RPC', () => {
  it('ignores other RPC types and denies every caller without an authorize hook', async () => {
    const { call, context } = harness(base);
    expect(await dispatchFeatureConsoleRpc({ type: 'plugin:set-enabled' }, context)).toBeNull();
    const denied = harness(base, { authorize: undefined });
    expect(await denied.call('feature.list')).toMatchObject({ status: 403, body: { success: false } });
    expect((await call('feature.list')).status).toBe(200);
  });

  it('passes level and key to the authorize hook', async () => {
    const authorize = vi.fn(async (request: { level?: string }) => request.level !== 'endpoint');
    const { call } = harness(base, { authorize });
    expect((await call('feature.get', { plugin: 'rss', level: 'adapter', key: 'qq' })).status).toBe(200);
    expect((await call('feature.get', { plugin: 'rss', level: 'endpoint', key: 'qq/bot-1' })).status).toBe(403);
    expect(authorize).toHaveBeenCalledWith({ type: 'feature.get', permission: 'feature.view', plugin: 'rss', level: 'endpoint', key: 'qq/bot-1' });
    const throwing = harness(base, { authorize: () => { throw new Error('boom'); } });
    expect((await throwing.call('feature.list')).status).toBe(403);
  });

  it('lists features with levels, schema presence and the global switch', async () => {
    const { call } = harness(base);
    const reply = await call('feature.list');
    expect(reply!.body.data).toMatchObject({ revision: 'r1', features: [
      { plugin: 'rss', displayName: 'RSS 订阅', levels: ['global', 'adapter', 'endpoint'], hasSchema: true, globalEnabled: true },
      { plugin: 'qq', levels: ['global'], hasSchema: false, globalEnabled: true, adapter: true },
      { plugin: 'tg', adapter: true },
      { plugin: 'plain', hasSchema: false, globalEnabled: false },
    ] });
  });

  it('builds the matrix with locks and override markers', async () => {
    const { call } = harness(base);
    const data = (await call('feature.matrix'))!.body.data as { adapters: string[]; endpoints: Record<string, string[]>; rows: { plugin: string; global: unknown; adapters: Record<string, unknown> }[] };
    expect(data.adapters).toEqual(['qq', 'tg']);
    expect(data.endpoints).toEqual({ qq: ['bot-1', 'bot-2'], tg: ['news'] });
    const row = (plugin: string) => data.rows.find(item => item.plugin === plugin)!;
    expect(row('rss')).toMatchObject({ global: { enabled: true, overridden: false },
      adapters: { qq: { enabled: false, overridden: true }, tg: { enabled: true, overridden: false } } });
    expect(row('plain')).toMatchObject({ global: { enabled: false, overridden: false },
      adapters: { qq: { enabled: false, lockedBy: 'global', overridden: false }, tg: { enabled: false, lockedBy: 'global', overridden: false } } });
  });

  it('reads one level with masked secrets, sources and locks', async () => {
    const { call } = harness(base);
    const endpoint = (await call('feature.get', { plugin: 'rss', level: 'endpoint', key: 'qq/bot-1' }))!.body.data as Record<string, unknown>;
    expect(endpoint).toMatchObject({ level: 'endpoint', key: 'qq/bot-1', enabled: false, lockedBy: 'adapter', values: {},
      effective: { maxItems: 3, apiKey: '[redacted]', style: { title: 'T', token: '[redacted]' } },
      sources: { '/maxItems': 'adapter', '/apiKey': 'global' } });
    expect(Object.keys((endpoint.schema as { properties: object }).properties)).toEqual(['maxItems', 'style']);
    const adapter = (await call('feature.get', { plugin: 'rss', level: 'adapter', key: 'qq' }))!.body.data as Record<string, unknown>;
    expect(adapter).toMatchObject({ values: { maxItems: 3 }, enabled: false });
    expect(adapter).not.toHaveProperty('lockedBy');
    const global = (await call('feature.get', { plugin: 'rss', level: 'global' }))!.body.data as Record<string, unknown>;
    expect(global.values).toEqual({ maxItems: 5, apiKey: '[redacted]', style: { title: 'T', token: '[redacted]' } });
    expect(JSON.stringify(global)).not.toContain('secret-token');
    expect(Object.keys((global.schema as { properties: object }).properties)).toEqual(['maxItems', 'apiKey', 'style']);
    expect((await call('feature.get', { plugin: 'ghost', level: 'global' }))!.status).toBe(404);
    expect((await call('feature.get', { plugin: 'rss', level: 'endpoint', key: 'no-slash' }))!.status).toBe(400);
  });

  it('writes overrides through the revision-checked patch path and reports warnings', async () => {
    const { call, state, patches } = harness(base);
    const reply = await call('feature.set-override', { plugin: 'rss', level: 'endpoint', key: 'qq/bot-9', patch: { maxItems: 2, style: null } });
    expect(reply!.body.data).toMatchObject({ status: 'saved', restartRequired: false,
      warnings: [{ code: 'unknown-endpoint', path: '/overrides/endpoints/qq~1bot-9' }] });
    expect(patches[0]).toMatchObject({ instanceKey: 'rss', expectedRevision: 'r1', patches: [{ op: 'set', path: ['rss', 'overrides'] }] });
    expect((state.document.rss as Record<string, any>).overrides.endpoints['qq/bot-9']).toEqual({ maxItems: 2, style: null });
    const invalid = await call('feature.set-override', { plugin: 'rss', level: 'endpoint', key: 'qq/bot-1', patch: { apiKey: 'x' } });
    expect(invalid!.body.data).toMatchObject({ status: 'invalid', errors: [{ path: '/overrides/endpoints/qq~1bot-1' }] });
    expect(patches).toHaveLength(1);
    const stale = await call('feature.set-override', { plugin: 'rss', level: 'adapter', key: 'tg', patch: { maxItems: 4 }, expectedRevision: 'r1' });
    expect(stale!.body.data).toMatchObject({ status: 'conflict', revision: 'r2' });
    expect((await call('feature.set-override', { plugin: 'rss', level: 'adapter', key: 'tg', patch: { enabled: false } }))!.status).toBe(400);
    expect((await call('feature.set-override', { plugin: 'rss', level: 'global', patch: { maxItems: 1 } }))!.status).toBe(400);
  });

  it('removes a whole level entry or selected fields and cleans empty containers', async () => {
    const { call, state } = harness({ ...base, rss: { ...base.rss, overrides: { endpoints: { 'tg/news': { maxItems: 1, style: { title: 'x' } } } } } });
    await call('feature.remove-override', { plugin: 'rss', level: 'endpoint', key: 'tg/news', paths: [['style', 'title']] });
    expect((state.document.rss as Record<string, any>).overrides).toEqual({ endpoints: { 'tg/news': { maxItems: 1 } } });
    const reply = await call('feature.remove-override', { plugin: 'rss', level: 'endpoint', key: 'tg/news' });
    expect(reply!.body.data).toMatchObject({ status: 'saved' });
    expect(state.document.rss).not.toHaveProperty('overrides');
    expect((await call('feature.remove-override', { plugin: 'rss', level: 'endpoint', key: 'tg/news' }))!.body.data).toMatchObject({ status: 'unchanged' });
  });

  it('stores enabled: false and deletes the key for enabled: true at adapter / endpoint levels', async () => {
    const { call, state } = harness(base);
    const off = await call('feature.set-enabled', { plugin: 'rss', level: 'endpoint', key: 'qq/bot-1', enabled: true });
    expect(off!.body.data).toMatchObject({ status: 'unchanged' });
    await call('feature.set-enabled', { plugin: 'rss', level: 'adapter', key: 'qq', enabled: true });
    expect((state.document.rss as Record<string, any>).overrides.adapters.qq).toEqual({ maxItems: 3 });
    await call('feature.set-enabled', { plugin: 'rss', level: 'endpoint', key: 'tg/news', enabled: false });
    expect((state.document.rss as Record<string, any>).overrides.endpoints['tg/news']).toEqual({ maxItems: 1, enabled: false });
    await call('feature.set-enabled', { plugin: 'rss', level: 'adapter', key: 'tg', enabled: false });
    const warned = await call('feature.set-enabled', { plugin: 'rss', level: 'endpoint', key: 'tg/other', enabled: false });
    expect(warned!.body.data).toMatchObject({ status: 'saved' });
    // Schema-less Plugins still get the three-level switch.
    await call('feature.set-enabled', { plugin: 'plain', level: 'endpoint', key: 'qq/bot-1', enabled: false });
    expect((state.document.plain as Record<string, any>).overrides).toEqual({ endpoints: { 'qq/bot-1': { enabled: false } } });
  });

  it('keeps the global switch on disable_plugins with a restart', async () => {
    vi.useFakeTimers();
    try {
      const setGlobalEnabled = vi.fn(async () => undefined);
      const requestRestart = vi.fn();
      const { call, patches } = harness(base, { setGlobalEnabled, requestRestart });
      const reply = await call('feature.set-enabled', { plugin: 'plain', level: 'global', enabled: true });
      expect(reply!.body.data).toMatchObject({ status: 'saved', restartRequired: true });
      expect(setGlobalEnabled).toHaveBeenCalledWith('plain', true);
      expect(patches).toEqual([]);
      vi.advanceTimersByTime(600);
      expect(requestRestart).toHaveBeenCalledOnce();
      expect((await call('feature.set-enabled', { plugin: 'rss', level: 'global', enabled: true }))!.body.data).toMatchObject({ status: 'unchanged' });
      expect((await call('feature.set-enabled', { plugin: 'rss', level: 'global', enabled: 'yes' }))!.status).toBe(400);
    } finally { vi.useRealTimers(); }
  });
});
