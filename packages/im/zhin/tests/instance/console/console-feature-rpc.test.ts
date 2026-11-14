import { describe, expect, it, vi } from 'vitest';
import {
  applyConfigPatches, childPluginId, createCapabilitySlot, featureId, rootPluginId,
  type PluginId, type RuntimeConfigDocument, type RuntimeSnapshot,
} from '@zhin.js/plugin-runtime';
import type { ConsoleConfigPatchRequest, ConsoleConfigPatchResult } from '@zhin.js/console-protocol';
import { PLUGIN_SWITCH_REQUIRES_GATEWAY } from '@zhin.js/host-http';
import {
  createFeatureRpcContext, dispatchFeatureConsoleRpc, type FeatureRpcContext,
} from '../../../src/instance/console/console-feature-rpc.js';
import { FeatureOverrideStore } from '../../../src/instance/console/feature-override-store.js';

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
    children: [], ...(configSchema ? { configSchema } : {}),
    ...(displayName ? { metadata: { displayName, ...(instanceKey === 'rss' ? { displayNameI18n: { en: 'RSS feeds' } } : {}) } } : {}),
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

type Entry = Record<string, unknown> & { enabled?: boolean };
/** ADR 0057 §2: stored adapter / endpoint entries per plugin (`{ rss: { qq: {...}, 'tg/news': {...} } }`). */
type Seed = Record<string, Record<string, Entry>>;

/** The adapter / endpoint overrides that used to be the `rss.overrides` block. */
const seed: Seed = { rss: { qq: { enabled: false, maxItems: 3 }, 'tg/news': { maxItems: 1 } } };

async function seeded(entries: Seed): Promise<FeatureOverrideStore> {
  const store = new FeatureOverrideStore();
  for (const [plugin, byKey] of Object.entries(entries)) {
    for (const [key, { enabled, ...patch }] of Object.entries(byKey)) {
      await store.write({ plugin, key, next: () => ({ ...(enabled === false ? { enabled: false as const } : {}), patch }) });
    }
  }
  return store;
}

/** The stored entry as `{ enabled?, ...patch }` (undefined when none). */
function stored(store: FeatureOverrideStore, plugin: string, key: string): Entry | undefined {
  const row = store.get(plugin, key);
  return row ? { ...row.patch, ...(row.enabled === false ? { enabled: false } : {}) } : undefined;
}

async function harness(document: RuntimeConfigDocument, options: Partial<FeatureRpcContext> = {}, entries: Seed = seed) {
  const overrides = await seeded(entries);
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
    authScope: 'full', authorize: () => true, configuration, snapshots: { acquire: () => ({ value: snap, release() {} }) as never },
    stores: { overrides }, ...options,
  };
  const call = async (type: string, data: Record<string, unknown> = {}) => dispatchFeatureConsoleRpc({ type, data, requestId: 7 }, context);
  return { state, patches, call, context, overrides };
}

const base = {
  configVersion: 2, plugins: { rss: '@x/rss', qq: '@x/qq', tg: '@x/tg', plain: '@x/plain' }, disable_plugins: ['plain'],
  qq: { endpoints: [{ id: 'bot-1' }, { id: 'bot-2' }] },
  rss: { maxItems: 5, apiKey: '${RSS_KEY}', style: { title: 'T', token: 'secret-token' } },
};

describe('feature.* Console RPC', () => {
  it('ignores other RPC types and denies every caller without an authorize hook', async () => {
    const { call, context } = await harness(base);
    expect(await dispatchFeatureConsoleRpc({ type: 'plugin:set-enabled' }, context)).toBeNull();
    const denied = await harness(base, { authorize: undefined });
    expect(await denied.call('feature.list')).toMatchObject({ status: 403, body: { success: false } });
    expect((await call('feature.list')).status).toBe(200);
  });

  it('passes level and key to the authorize hook', async () => {
    const authorize = vi.fn(async (request: { level?: string }) => request.level !== 'endpoint');
    const { call } = await harness(base, { authorize });
    expect((await call('feature.get', { plugin: 'rss', level: 'adapter', key: 'qq' })).status).toBe(200);
    expect((await call('feature.get', { plugin: 'rss', level: 'endpoint', key: 'qq/bot-1' })).status).toBe(403);
    expect(authorize).toHaveBeenCalledWith({ type: 'feature.get', permission: 'feature.view', plugin: 'rss', level: 'endpoint', key: 'qq/bot-1' });
    const throwing = await harness(base, { authorize: () => { throw new Error('boom'); } });
    expect((await throwing.call('feature.list')).status).toBe(403);
  });

  it('lists features with levels, schema presence and the global switch', async () => {
    const { call } = await harness(base);
    const reply = await call('feature.list');
    expect(reply!.body.data).toMatchObject({ revision: 'r1', features: [
      { plugin: 'rss', displayName: 'RSS 订阅', displayNameI18n: { en: 'RSS feeds' }, levels: ['global', 'adapter', 'endpoint'], hasSchema: true, globalEnabled: true },
      { plugin: 'qq', levels: ['global'], hasSchema: false, globalEnabled: true, adapter: true },
      { plugin: 'tg', adapter: true },
      { plugin: 'plain', hasSchema: false, globalEnabled: false },
    ] });
  });

  it('builds the matrix with locks and override markers', async () => {
    const { call } = await harness(base);
    const data = (await call('feature.matrix'))!.body.data as { adapters: string[]; endpoints: Record<string, string[]>; rows: { plugin: string; global: unknown; adapters: Record<string, unknown> }[] };
    expect(data.adapters).toEqual(['qq', 'tg']);
    expect(data.endpoints).toEqual({ qq: ['bot-1', 'bot-2'], tg: ['news'] });
    const row = (plugin: string) => data.rows.find(item => item.plugin === plugin)!;
    expect(row('rss')).toMatchObject({ displayName: 'RSS 订阅', displayNameI18n: { en: 'RSS feeds' }, global: { enabled: true, overridden: false },
      adapters: { qq: { enabled: false, overridden: true }, tg: { enabled: true, overridden: false } } });
    expect(row('plain')).not.toHaveProperty('displayNameI18n');
    expect(row('plain')).toMatchObject({ global: { enabled: false, overridden: false },
      adapters: { qq: { enabled: false, lockedBy: 'global', overridden: false }, tg: { enabled: false, lockedBy: 'global', overridden: false } } });
  });

  it('lists the root plugin\'s own commands as a read-only row and tells plugins from adapters (#1250)', async () => {
    const snap = snapshot();
    const command = (owner: PluginId, localName: string, feature = 'zhin.command') =>
      createCapabilitySlot({ owner, feature: featureId(feature), localName, source: `/${localName}.ts`, definition: {} });
    const extra = [command(root, 'hello'), command(root, 'card'), command(root, 'status-card', 'zhin.component'), command(rss, 'news')];
    const withCommands = { ...snap, capabilities: new Map([...snap.capabilities, ...extra.map(slot => [slot.id, slot] as const)]) };
    const { call } = await harness(base, { snapshots: { acquire: () => ({ value: withCommands, release() {} }) } as never });
    const data = (await call('feature.matrix'))!.body.data as { rows: Array<Record<string, unknown> & { plugin: string; kind?: string }> };
    expect(data.rows[0]).toEqual({
      plugin: '', displayName: '本项目（@x/root）', kind: 'root', readOnly: true,
      capabilities: { commands: ['card', 'hello'], components: ['status-card'], tools: [] },
      global: { enabled: true, overridden: false }, adapters: { qq: { enabled: true, overridden: false }, tg: { enabled: true, overridden: false } },
    });
    const kinds = data.rows.map(row => [row.plugin, row.kind]);
    expect(kinds.slice(1)).toEqual(expect.arrayContaining([['rss', 'plugin'], ['plain', 'plugin'], ['qq', 'adapter'], ['tg', 'adapter']]));
    expect(kinds.findIndex(([, kind]) => kind === 'adapter')).toBeGreaterThan(kinds.findLastIndex(([, kind]) => kind === 'plugin'));
    expect(data.rows.find(row => row.plugin === 'rss')).toMatchObject({ capabilities: { commands: ['news'] } });
    const list = (await call('feature.list'))!.body.data as { features: Array<{ plugin: string; kind?: string }> };
    expect(list.features.find(feature => feature.plugin === 'qq')).toMatchObject({ kind: 'adapter', adapter: true });
    expect(list.features.some(feature => feature.plugin === '')).toBe(false);
  });

  it('omits the root row when the root plugin contributes nothing', async () => {
    const { call } = await harness(base);
    const data = (await call('feature.matrix'))!.body.data as { rows: Array<{ kind?: string }> };
    expect(data.rows.some(row => row.kind === 'root')).toBe(false);
  });

  it('reads one level with masked secrets, sources, locks and the stored row revision', async () => {
    const { call } = await harness(base);
    const endpoint = (await call('feature.get', { plugin: 'rss', level: 'endpoint', key: 'qq/bot-1' }))!.body.data as Record<string, unknown>;
    expect(endpoint).toMatchObject({ level: 'endpoint', key: 'qq/bot-1', enabled: false, lockedBy: 'adapter', values: {}, revision: '0',
      effective: { maxItems: 3, apiKey: '[redacted]', style: { title: 'T', token: '[redacted]' } },
      sources: { '/maxItems': 'adapter', '/apiKey': 'global' }, persistent: true });
    expect(Object.keys((endpoint.schema as { properties: object }).properties)).toEqual(['maxItems', 'style']);
    const adapter = (await call('feature.get', { plugin: 'rss', level: 'adapter', key: 'qq' }))!.body.data as Record<string, unknown>;
    expect(adapter).toMatchObject({ values: { maxItems: 3 }, enabled: false, revision: '1', updatedAt: expect.any(Number) });
    expect(adapter).not.toHaveProperty('lockedBy');
    const global = (await call('feature.get', { plugin: 'rss', level: 'global' }))!.body.data as Record<string, unknown>;
    expect(global.values).toEqual({ maxItems: 5, apiKey: '[redacted]', style: { title: 'T', token: '[redacted]' } });
    expect(global.revision).toBe('r1');
    expect(JSON.stringify(global)).not.toContain('secret-token');
    expect(Object.keys((global.schema as { properties: object }).properties)).toEqual(['maxItems', 'apiKey', 'style']);
    expect((await call('feature.get', { plugin: 'ghost', level: 'global' }))!.status).toBe(404);
    expect((await call('feature.get', { plugin: 'rss', level: 'endpoint', key: 'no-slash' }))!.status).toBe(400);
    // Adapter / endpoint levels need the store (ADR 0057 §2).
    const storeless = await harness(base, { stores: undefined });
    expect((await storeless.call('feature.get', { plugin: 'rss', level: 'adapter', key: 'qq' }))!.status).toBe(503);
    expect((await storeless.call('feature.get', { plugin: 'rss', level: 'global' }))!.status).toBe(200);
  });

  it('ignores a legacy overrides block in the configuration file', async () => {
    const { call } = await harness({ ...base, rss: { ...base.rss, overrides: { adapters: { tg: { enabled: false, maxItems: 9 } } } } }, {}, {});
    const adapter = (await call('feature.get', { plugin: 'rss', level: 'adapter', key: 'tg' }))!.body.data as Record<string, unknown>;
    expect(adapter).toMatchObject({ values: {}, enabled: true, effective: { maxItems: 5 } });
    expect(Object.keys((adapter.schema as { properties: object }).properties)).not.toContain('overrides');
  });

  it('writes adapter / endpoint overrides to the store at once (no configuration write, no restart) and reports warnings', async () => {
    const events: unknown[] = [];
    const { call, patches, overrides } = await harness(base, { actor: 'user:u1', publishEvent: (type, data) => { events.push([type, data]); } });
    const version = overrides.version;
    const reply = await call('feature.set-override', { plugin: 'rss', level: 'endpoint', key: 'qq/bot-9', patch: { maxItems: 2, style: null } });
    expect(reply!.body.data).toMatchObject({ status: 'saved', revision: '1', restartRequired: false, persistent: true,
      warnings: [{ code: 'unknown-endpoint', path: '/overrides/endpoints/qq~1bot-9' }] });
    expect(patches).toEqual([]);
    expect(overrides.version).toBe(version + 1);
    expect(overrides.get('rss', 'qq/bot-9')).toMatchObject({ level: 'endpoint', patch: { maxItems: 2, style: null }, updatedBy: 'user:u1' });
    expect(events).toEqual([['feature:updated', { plugin: 'rss', level: 'endpoint', key: 'qq/bot-9' }]]);
    const invalid = await call('feature.set-override', { plugin: 'rss', level: 'endpoint', key: 'qq/bot-1', patch: { apiKey: 'x' } });
    expect(invalid!.body.data).toMatchObject({ status: 'invalid', revision: '0', errors: [{ path: '', message: expect.stringContaining('apiKey') }] });
    expect(overrides.get('rss', 'qq/bot-1')).toBeUndefined();
    // Revision compare-and-swap on the stored row.
    expect((await call('feature.set-override', { plugin: 'rss', level: 'adapter', key: 'tg', patch: { maxItems: 4 }, expectedRevision: '0' }))!.body.data)
      .toMatchObject({ status: 'saved', revision: '1' });
    expect((await call('feature.set-override', { plugin: 'rss', level: 'adapter', key: 'tg', patch: { maxItems: 6 }, expectedRevision: '0' }))!.body.data)
      .toMatchObject({ status: 'conflict', revision: '1' });
    // Console builds before ADR 0057 send the configuration revision: accepted while it is current, a conflict otherwise.
    expect((await call('feature.set-override', { plugin: 'rss', level: 'adapter', key: 'tg', patch: { maxItems: 6 }, expectedRevision: 'r1' }))!.body.data)
      .toMatchObject({ status: 'saved', revision: '2' });
    expect((await call('feature.set-override', { plugin: 'rss', level: 'adapter', key: 'tg', patch: { maxItems: 7 }, expectedRevision: 'r0' }))!.body.data)
      .toMatchObject({ status: 'conflict', revision: '2' });
    expect(stored(overrides, 'rss', 'tg')).toEqual({ maxItems: 6 });
    expect((await call('feature.set-override', { plugin: 'rss', level: 'adapter', key: 'tg', patch: { enabled: false } }))!.status).toBe(400);
    expect((await call('feature.set-override', { plugin: 'rss', level: 'global', patch: { maxItems: 1 } }))!.status).toBe(400);
    // A Plugin without a schema can only switch below global.
    expect((await call('feature.set-override', { plugin: 'qq', level: 'adapter', key: 'tg', patch: { x: 1 } }))!.body.data).toMatchObject({ status: 'invalid' });
  });

  it('refuses writes when the project database cannot persist them (ADR 0057 §2)', async () => {
    const database = { dialect: 'redis', started: true, models: { get: () => undefined } };
    const store = new FeatureOverrideStore({ database: database as never });
    await store.load();
    const { call } = await harness(base, { stores: { overrides: store } }, {});
    for (const [type, data] of [
      ['feature.set-override', { plugin: 'rss', level: 'adapter', key: 'qq', patch: { maxItems: 2 } }],
      ['feature.set-enabled', { plugin: 'rss', level: 'endpoint', key: 'qq/bot-1', enabled: false }],
      ['feature.set-enabled', { plugin: 'rss', level: 'conversation', key: 'qq/bot-1/group:1', enabled: false }],
    ] as const) {
      expect(await call(type, data)).toMatchObject({ status: 503, body: { success: false, code: 'feature-overrides-unpersisted',
        error: expect.stringContaining('关系型项目数据库') } });
    }
    expect(store.list()).toEqual([]);
    expect(((await call('feature.get', { plugin: 'rss', level: 'adapter', key: 'qq' }))!.body.data as Record<string, unknown>).persistent).toBe(false);
  });

  it('refuses environment references unless the caller may edit the environment', async () => {
    const denied = await harness(base);
    for (const patch of [{ style: { title: '${RSS_KEY}' } }, { style: { title: 'env://RSS_KEY' } }, { style: { ['${X}']: 'a' } }]) {
      const reply = await denied.call('feature.set-override', { plugin: 'rss', level: 'endpoint', key: 'qq/bot-1', patch });
      expect(reply).toMatchObject({ status: 400, body: { success: false, code: 'environment-reference' } });
    }
    expect(denied.overrides.get('rss', 'qq/bot-1')).toBeUndefined();
    const throwing = await harness(base, { mayReferenceEnvironment: () => { throw new Error('boom'); } });
    expect((await throwing.call('feature.set-override', { plugin: 'rss', level: 'endpoint', key: 'qq/bot-1', patch: { style: { title: '${RSS_KEY}' } } }))!.status).toBe(400);
    const allowed = await harness(base, { mayReferenceEnvironment: () => true });
    const saved = await allowed.call('feature.set-override', { plugin: 'rss', level: 'endpoint', key: 'qq/bot-1', patch: { style: { title: '${RSS_KEY}' } } });
    expect(saved!.body.data).toMatchObject({ status: 'saved' });
  });

  it('removes a whole level entry or selected fields and cleans empty containers', async () => {
    const { call, overrides } = await harness(base, {}, { rss: { 'tg/news': { maxItems: 1, style: { title: 'x' } } } });
    await call('feature.remove-override', { plugin: 'rss', level: 'endpoint', key: 'tg/news', paths: [['style', 'title']] });
    expect(stored(overrides, 'rss', 'tg/news')).toEqual({ maxItems: 1 });
    const reply = await call('feature.remove-override', { plugin: 'rss', level: 'endpoint', key: 'tg/news' });
    expect(reply!.body.data).toMatchObject({ status: 'saved', revision: '3' });
    expect(overrides.get('rss', 'tg/news')).toBeUndefined();
    // Tombstone: the revision keeps counting.
    expect(overrides.revisionOf('rss', 'tg/news')).toBe(3);
    expect((await call('feature.remove-override', { plugin: 'rss', level: 'endpoint', key: 'tg/news' }))!.body.data).toMatchObject({ status: 'unchanged' });
  });

  it('stores enabled: false and deletes the switch for enabled: true at adapter / endpoint levels', async () => {
    const { call, patches, overrides } = await harness(base);
    await call('feature.set-enabled', { plugin: 'rss', level: 'adapter', key: 'qq', enabled: true });
    expect(stored(overrides, 'rss', 'qq')).toEqual({ maxItems: 3 });
    await call('feature.set-enabled', { plugin: 'rss', level: 'endpoint', key: 'tg/news', enabled: false });
    expect(stored(overrides, 'rss', 'tg/news')).toEqual({ maxItems: 1, enabled: false });
    expect((await call('feature.set-enabled', { plugin: 'rss', level: 'endpoint', key: 'tg/news', enabled: true }))!.body.data).toMatchObject({ status: 'saved' });
    expect(stored(overrides, 'rss', 'tg/news')).toEqual({ maxItems: 1 });
    // A switch-only entry disappears when it is enabled again.
    await call('feature.set-enabled', { plugin: 'rss', level: 'adapter', key: 'tg', enabled: false });
    expect(stored(overrides, 'rss', 'tg')).toEqual({ enabled: false });
    await call('feature.set-enabled', { plugin: 'rss', level: 'adapter', key: 'tg', enabled: true });
    expect(overrides.get('rss', 'tg')).toBeUndefined();
    expect(patches).toEqual([]);
  });

  it('locks every level below a disabled level in both directions (ADR 0050 §4)', async () => {
    const { call, patches, overrides } = await harness(base);
    // rss is disabled at adapter qq: the endpoint switch below it can neither enable nor disable.
    for (const enabled of [true, false]) {
      const reply = await call('feature.set-enabled', { plugin: 'rss', level: 'endpoint', key: 'qq/bot-1', enabled });
      expect(reply).toMatchObject({ status: 409, body: { success: false, code: 'locked', lockedBy: 'adapter', error: '已被适配器层停用，下级开关已锁定' } });
    }
    // ... nor the conversation switches below it.
    expect(await call('feature.set-enabled', { plugin: 'rss', level: 'conversation', key: 'qq/bot-1/group:1', enabled: false }))
      .toMatchObject({ status: 409, body: { code: 'locked', lockedBy: 'adapter' } });
    // plain is disabled globally: adapter and endpoint switches are locked by global.
    expect(await call('feature.set-enabled', { plugin: 'plain', level: 'adapter', key: 'qq', enabled: false }))
      .toMatchObject({ status: 409, body: { code: 'locked', lockedBy: 'global', error: '已被全局层停用，下级开关已锁定' } });
    expect(patches).toEqual([]);
    expect(overrides.list()).toHaveLength(2);
    // A lower `enabled: false` stored before the upper disable is kept by remove-override.
    const kept = await harness(base, {}, { rss: { ...seed.rss, 'qq/bot-1': { enabled: false, maxItems: 2 } } });
    await kept.call('feature.remove-override', { plugin: 'rss', level: 'endpoint', key: 'qq/bot-1' });
    expect(stored(kept.overrides, 'rss', 'qq/bot-1')).toEqual({ enabled: false });
    expect(await kept.call('feature.remove-override', { plugin: 'rss', level: 'endpoint', key: 'qq/bot-1', paths: [['enabled']] }))
      .toMatchObject({ status: 409, body: { code: 'locked' } });
  });

  it('keeps the in-chat global switch on disable_plugins with a restart (setGlobalEnabled)', async () => {
    vi.useFakeTimers();
    try {
      const setGlobalEnabled = vi.fn(async () => undefined);
      const requestRestart = vi.fn();
      const { call, patches } = await harness(base, { setGlobalEnabled, requestRestart });
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

  it('refuses the global switch on the Console path: it is a gateway transaction (ADR 0054 §4)', async () => {
    vi.useFakeTimers();
    try {
      const published: string[] = [];
      const { call, patches, context } = await harness(base, { publishEvent: type => { published.push(type); } });
      for (const enabled of [true, false]) {
        // Refused whatever the current state (plain is disabled, rss enabled): never "unchanged".
        for (const plugin of ['plain', 'rss']) {
          const reply = await call('feature.set-enabled', { plugin, level: 'global', enabled });
          expect(reply).toMatchObject({ status: 409, body: { success: false, code: 'gateway-required', error: PLUGIN_SWITCH_REQUIRES_GATEWAY } });
        }
      }
      expect(patches).toEqual([]);
      expect(published).toEqual([]);
      expect(context.setGlobalEnabled).toBeUndefined();
      // Lower levels keep working on the instance (feature switches, ADR 0050 / 0055).
      expect((await call('feature.set-enabled', { plugin: 'rss', level: 'endpoint', key: 'tg/news', enabled: false }))!.body.data).toMatchObject({ status: 'saved' });
    } finally { vi.useRealTimers(); }
  });

  it('builds the Console context without a global writer or restart hook', async () => {
    const { context } = await harness(base);
    const consoleContext = createFeatureRpcContext({
      configuration: context.configuration as never,
      snapshots: context.snapshots as never,
      hub: { publish: () => undefined } as never,
    }, 'full', () => true);
    expect(consoleContext.setGlobalEnabled).toBeUndefined();
    expect(consoleContext.requestRestart).toBeUndefined();
    const reply = await dispatchFeatureConsoleRpc({ type: 'feature.set-enabled', data: { plugin: 'plain', level: 'global', enabled: true } }, consoleContext);
    expect(reply).toMatchObject({ status: 409, body: { code: 'gateway-required' } });
  });
});
