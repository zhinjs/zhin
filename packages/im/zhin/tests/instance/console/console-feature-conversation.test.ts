import { describe, expect, it } from 'vitest';
import {
  applyConfigPatches, childPluginId, createCapabilitySlot, featureId, rootPluginId,
  type PluginId, type RuntimeConfigDocument, type RuntimeSnapshot,
} from '@zhin.js/plugin-runtime';
import type { ConsoleConfigPatchRequest, ConsoleConfigPatchResult } from '@zhin.js/console-protocol';
import { dispatchFeatureConsoleRpc, type FeatureRpcAuthorization, type FeatureRpcContext } from '../../../src/instance/console/console-feature-rpc.js';
import { FeatureConversationOverrideStore } from '../../../src/instance/console/feature-conversation-store.js';

const root = rootPluginId();
const repeater = childPluginId(root, 'repeater');
const rss = childPluginId(root, 'rss');
const plain = childPluginId(root, 'plain');
const qq = childPluginId(root, 'qq');

const repeaterSchema = {
  type: 'object', additionalProperties: false,
  'x-zhin-config': { levels: ['global', 'adapter', 'endpoint', 'conversation'], conversationFields: ['threshold', 'cooldown'], selfServiceFields: ['threshold'] },
  properties: {
    commandNamespace: { type: 'string' }, overrides: { type: 'object' },
    threshold: { type: 'integer', minimum: 2 },
    cooldown: { type: 'integer', minimum: 0 },
    secret: { type: 'string', 'x-zhin-config': { levels: ['global'] } },
  },
};

function snapshot(): RuntimeSnapshot {
  const node = (id: PluginId, instanceKey: string, configSchema?: object) => ({
    id, instanceKey, packageName: `@x/${instanceKey}`, packageRoot: `/x/${instanceKey}`, parent: id === root ? undefined : root,
    children: [], ...(configSchema ? { configSchema } : {}),
  });
  const adapter = createCapabilitySlot({ owner: qq, feature: featureId('zhin.adapter'), localName: 'main', source: '/a.ts', definition: {} });
  return {
    generation: 1, root,
    tree: new Map([[root, node(root, 'root')], [repeater, node(repeater, 'repeater', repeaterSchema)], [rss, node(rss, 'rss')],
      [plain, node(plain, 'plain')], [qq, node(qq, 'qq')]]) as never,
    config: new Map(), resources: new Map(), projections: new Map(), capabilities: new Map([[adapter.id, adapter]]),
  };
}

const base: RuntimeConfigDocument = {
  configVersion: 2, plugins: { repeater: '@x/repeater', rss: '@x/rss', plain: '@x/plain', qq: '@x/qq' }, disable_plugins: ['plain'],
  qq: { endpoints: [{ id: 'bot-1' }, { id: 'bot-2' }] },
  repeater: { threshold: 3, cooldown: 10, overrides: { endpoints: { 'qq/bot-2': { enabled: false } } } },
};

function harness(options: Partial<FeatureRpcContext> = {}) {
  const state = { document: structuredClone(base), revision: 1 };
  const configuration = {
    async readProject() { return { revision: `r${state.revision}`, exists: true, value: structuredClone(state.document) }; },
    async patch(request: ConsoleConfigPatchRequest): Promise<ConsoleConfigPatchResult> {
      state.document = applyConfigPatches(state.document, request.patches as never);
      state.revision += 1;
      return { status: 'saved', revision: `r${state.revision}`, restartRequired: false, paths: [], missingEnv: [], message: 'ok' };
    },
  };
  const conversations = new FeatureConversationOverrideStore();
  const snap = snapshot();
  const authorized: FeatureRpcAuthorization[] = [];
  const events: string[] = [];
  const context: FeatureRpcContext = {
    authScope: 'full', authorize: request => { authorized.push(request); return true; }, configuration,
    snapshots: { acquire: () => ({ value: snap, release() {} }) as never },
    stores: { conversations, recentConversations: async () => [{ key: 'qq/bot-1/group:7', name: 'Seven', lastActiveAt: 5 }, { key: 'not a key' }] },
    publishEvent: type => { events.push(type); }, actor: 'user:u1', ...options,
  };
  const call = async (type: string, data: Record<string, unknown> = {}) => dispatchFeatureConsoleRpc({ type, data }, context);
  return { call, conversations, authorized, events, state };
}

const g1 = 'qq/bot-1/group:1001';

describe('feature.* at the conversation level (ADR 0055)', () => {
  it('reads a conversation level with narrowed schema, declarations and the store revision', async () => {
    const { call, authorized } = harness();
    const reply = await call('feature.get', { plugin: 'repeater', level: 'conversation', key: g1 });
    expect(reply).toMatchObject({ status: 200, body: { success: true, data: {
      revision: '0', level: 'conversation', key: g1, enabled: true, conversationFields: ['threshold', 'cooldown'], selfServiceFields: ['threshold'],
      conversation: { adapter: 'qq', endpointId: 'bot-1', kind: 'group', id: '1001' }, effective: { threshold: 3, cooldown: 10 },
    } } });
    expect(Object.keys((reply!.body.data as any).schema.properties)).toEqual(['threshold', 'cooldown']);
    expect(authorized.at(-1)).toMatchObject({ type: 'feature.get', permission: 'feature.view', level: 'conversation', key: g1 });
    expect((await call('feature.get', { plugin: 'repeater', level: 'conversation', key: 'qq/bot-1/group' }))!.status).toBe(400);
    expect((await call('feature.get', { plugin: 'repeater', level: 'conversation', key: 'qq/bot-1/room:1' }))!.status).toBe(400);
  });

  it('writes field overrides in place, validates them and checks the revision', async () => {
    const { call, conversations, events } = harness();
    const saved = await call('feature.set-override', { plugin: 'repeater', level: 'conversation', key: g1, patch: { threshold: 6 } });
    expect(saved!.body.data).toMatchObject({ status: 'saved', revision: '1', restartRequired: false });
    expect(conversations.get('repeater', g1)).toMatchObject({ patch: { threshold: 6 }, updatedBy: 'user:u1' });
    expect(events).toContain('feature:updated');
    const read = await call('feature.get', { plugin: 'repeater', level: 'conversation', key: g1 });
    expect(read!.body.data).toMatchObject({ revision: '1', values: { threshold: 6 }, effective: { threshold: 6, cooldown: 10 },
      sources: { '/threshold': 'conversation', '/cooldown': 'global' }, updatedBy: 'user:u1' });
    // Only conversationFields; schema bounds apply; stale revisions conflict.
    expect((await call('feature.set-override', { plugin: 'repeater', level: 'conversation', key: g1, patch: { secret: 'x' } }))!.body.data)
      .toMatchObject({ status: 'invalid' });
    expect((await call('feature.set-override', { plugin: 'repeater', level: 'conversation', key: g1, patch: { threshold: 1 } }))!.body.data)
      .toMatchObject({ status: 'invalid' });
    expect((await call('feature.set-override', { plugin: 'repeater', level: 'conversation', key: g1, patch: { cooldown: 1 }, expectedRevision: '0' }))!.body.data)
      .toMatchObject({ status: 'conflict', revision: '1' });
    expect(conversations.get('repeater', g1)?.patch).toEqual({ threshold: 6 });
    await call('feature.remove-override', { plugin: 'repeater', level: 'conversation', key: g1, paths: [['threshold']] });
    expect(conversations.get('repeater', g1)).toBeUndefined();
  });

  it('toggles the conversation switch, never stores enabled, and is locked below a disabled endpoint', async () => {
    const { call, conversations } = harness();
    await call('feature.set-enabled', { plugin: 'repeater', level: 'conversation', key: g1, enabled: false });
    expect(conversations.get('repeater', g1)).toMatchObject({ enabled: false, patch: {} });
    expect((await call('feature.get', { plugin: 'repeater', level: 'conversation', key: g1 }))!.body.data).toMatchObject({ enabled: false });
    await call('feature.set-enabled', { plugin: 'repeater', level: 'conversation', key: g1, enabled: true });
    expect(conversations.get('repeater', g1)).toBeUndefined();
    for (const enabled of [true, false]) {
      expect(await call('feature.set-enabled', { plugin: 'repeater', level: 'conversation', key: 'qq/bot-2/group:1', enabled }))
        .toMatchObject({ status: 409, body: { success: false, code: 'locked', lockedBy: 'endpoint', error: '已被账号层停用，下级开关已锁定' } });
    }
    expect((await call('feature.get', { plugin: 'repeater', level: 'conversation', key: 'qq/bot-2/group:1' }))!.body.data)
      .toMatchObject({ enabled: false, lockedBy: 'endpoint' });
    expect(await call('feature.set-enabled', { plugin: 'plain', level: 'conversation', key: g1, enabled: false }))
      .toMatchObject({ status: 409, body: { lockedBy: 'global' } });
  });

  it('gives schema-less plugins the conversation switch only', async () => {
    const { call, conversations } = harness();
    expect((await call('feature.set-enabled', { plugin: 'rss', level: 'conversation', key: g1, enabled: false }))!.body.data).toMatchObject({ status: 'saved' });
    expect(conversations.get('rss', g1)?.enabled).toBe(false);
    expect((await call('feature.set-override', { plugin: 'rss', level: 'conversation', key: g1, patch: { maxItems: 1 } }))!.body.data).toMatchObject({ status: 'invalid' });
  });

  it('lists conversations with overrides and known recent ones, filtered and paginated', async () => {
    const { call } = harness();
    await call('feature.set-enabled', { plugin: 'rss', level: 'conversation', key: g1, enabled: false });
    await call('feature.set-override', { plugin: 'repeater', level: 'conversation', key: g1, patch: { threshold: 4 } });
    await call('feature.set-enabled', { plugin: 'rss', level: 'conversation', key: 'qq/bot-1/private:a%2Fb', enabled: false });
    const all = (await call('feature.conversations', {}))!.body.data as any;
    expect(all.recentAvailable).toBe(true);
    // Overridden first (newest write first), then recent conversations without overrides.
    expect(all.conversations.slice(0, 2).map((item: any) => item.key).sort()).toEqual([g1, 'qq/bot-1/private:a%2Fb']);
    expect(all.conversations.map((item: any) => item.hasOverrides)).toEqual([true, true, false]);
    const byKey = Object.fromEntries(all.conversations.map((item: any) => [item.key, item]));
    expect(byKey['qq/bot-1/private:a%2Fb']).toMatchObject({ kind: 'private', id: 'a/b', overrides: [{ plugin: 'rss', enabled: false, fields: [] }] });
    expect(byKey[g1].overrides.map((item: any) => item.plugin)).toEqual(['repeater', 'rss']);
    expect(byKey[g1].overrides[0]).toMatchObject({ fields: ['threshold'] });
    expect(all.conversations[2]).toMatchObject({ key: 'qq/bot-1/group:7', name: 'Seven', overrides: [] });
    const byPlugin = (await call('feature.conversations', { plugin: 'repeater' }))!.body.data as any;
    expect(byPlugin.conversations.map((item: any) => item.key)).toEqual([g1]);
    const page = (await call('feature.conversations', { limit: 1 }))!.body.data as any;
    expect(page).toMatchObject({ nextCursor: 'o:1' });
    const next = (await call('feature.conversations', { limit: 2, cursor: page.nextCursor }))!.body.data as any;
    expect(next.conversations).toHaveLength(2);
    expect(next.nextCursor).toBeUndefined();
    expect(((await call('feature.conversations', { query: 'seven' }))!.body.data as any).conversations.map((item: any) => item.key)).toEqual(['qq/bot-1/group:7']);
    expect(((await call('feature.conversations', { adapter: 'tg' }))!.body.data as any).conversations).toEqual([]);
    expect((await call('feature.conversations', { endpoint: 'bot-1' }))!.status).toBe(400);
    const matrix = (await call('feature.matrix', {}))!.body.data as any;
    expect(matrix.conversationOverrides).toEqual({ qq: { 'bot-1': 2 } });
    expect(matrix.rows.find((row: any) => row.plugin === 'rss').conversationOverrides).toEqual({ qq: { 'bot-1': 2 } });
  });

  it('reports whether conversation overrides persist and says so on writes', async () => {
    const { call } = harness();
    expect((await call('feature.get', { plugin: 'repeater', level: 'conversation', key: g1 }))!.body.data).toMatchObject({ persistent: false });
    expect((await call('feature.conversations'))!.body.data).toMatchObject({ persistent: false });
    const saved = await call('feature.set-enabled', { plugin: 'rss', level: 'conversation', key: g1, enabled: false });
    expect(saved!.body.data).toMatchObject({ status: 'saved', persistent: false, message: '会话覆盖已保存，立即生效；当前数据库不支持持久化，重启后丢失' });
    class Persistent extends FeatureConversationOverrideStore { override get persistent(): boolean { return true; } }
    const durable = harness({ stores: { conversations: new Persistent() } });
    expect((await durable.call('feature.set-enabled', { plugin: 'rss', level: 'conversation', key: g1, enabled: false }))!.body.data)
      .toMatchObject({ persistent: true, message: '会话覆盖已保存，立即生效' });
  });

  it('keeps the revision monotonic after a removal (no ABA through feature.get)', async () => {
    const { call } = harness();
    await call('feature.set-enabled', { plugin: 'rss', level: 'conversation', key: g1, enabled: false, expectedRevision: '0' });
    await call('feature.set-enabled', { plugin: 'rss', level: 'conversation', key: g1, enabled: true, expectedRevision: '1' });
    expect((await call('feature.get', { plugin: 'rss', level: 'conversation', key: g1 }))!.body.data).toMatchObject({ revision: '2', enabled: true });
    expect((await call('feature.set-enabled', { plugin: 'rss', level: 'conversation', key: g1, enabled: false, expectedRevision: '0' }))!.body.data)
      .toMatchObject({ status: 'conflict', revision: '2' });
  });

  it('validates conversation keys by their parts, not by a fixed total length', async () => {
    const { call } = harness();
    // A 256-character id made of escaped slashes is a valid Runtime key (768 characters escaped).
    const long = `qq/bot-1/group:${'%2F'.repeat(256)}`;
    expect((await call('feature.get', { plugin: 'repeater', level: 'conversation', key: long }))!.status).toBe(200);
    expect((await call('feature.get', { plugin: 'repeater', level: 'conversation', key: `qq/bot-1/group:${'a'.repeat(257)}` }))!.status).toBe(400);
    expect((await call('feature.get', { plugin: 'repeater', level: 'conversation', key: `qq/${'b'.repeat(129)}/group:1` }))!.status).toBe(400);
  });

  it('locks a nested plugin wherever an ancestor is switched off above the level (409 locked)', async () => {
    const { call } = harness();
    // repeater is disabled at endpoint qq/bot-2, so repeater/child is locked in that account's conversations.
    const reply = await call('feature.set-enabled', { plugin: 'repeater/child', level: 'conversation', key: 'qq/bot-2/group:1', enabled: false });
    expect(reply).toMatchObject({ status: 409, body: { success: false, code: 'locked', lockedBy: 'endpoint' } });
    expect((await call('feature.get', { plugin: 'repeater/child', level: 'conversation', key: 'qq/bot-2/group:1' }))!.body.data)
      .toMatchObject({ enabled: false, lockedBy: 'endpoint' });
    // Elsewhere the child keeps its own switch.
    expect((await call('feature.set-enabled', { plugin: 'repeater/child', level: 'conversation', key: g1, enabled: false }))!.body.data)
      .toMatchObject({ status: 'saved' });
  });

  it('answers 503 for conversation calls without the stores', async () => {
    const { call } = harness({ stores: undefined });
    expect((await call('feature.get', { plugin: 'repeater', level: 'conversation', key: g1 }))!.status).toBe(503);
    expect((await call('feature.conversations'))!.status).toBe(503);
  });
});
