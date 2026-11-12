import { describe, expect, it, vi } from 'vitest';
import {
  applyConfigPatches, childPluginId, featureId, rootPluginId,
  type PluginId, type RuntimeConfigDocument, type RuntimeSnapshot,
} from '@zhin.js/plugin-runtime';
import type { ConsoleConfigPatchRequest, ConsoleConfigPatchResult } from '@zhin.js/console-protocol';
import type { ConsoleAuditEntry } from '@zhin.js/host-http';
import { FeatureConversationOverrideStore } from '../../src/instance/console/feature-conversation-store.js';
import {
  ChatRoleService, ChatRoleStore, createConfigChatRoleSource, createPlatformChatRoleSource,
} from '../../src/instance/chat-roles.js';
import {
  DEFAULT_FEATURE_SELF_SERVICE, executeFeatureChat, executeRoleChat, featureChatActor, featureChatTokens, platformMappingOf,
  readFeatureSelfServiceConfig,
  type FeatureChatActor, type FeatureSelfServiceConfig,
} from '../../src/instance/feature-self-service.js';

const root = rootPluginId();
const repeater = childPluginId(root, 'repeater');
const rss = childPluginId(root, 'rss');
const qq = childPluginId(root, 'qq');
const tg = childPluginId(root, 'tg');

const repeaterSchema = {
  type: 'object', additionalProperties: false,
  'x-zhin-config': { levels: ['global', 'adapter', 'endpoint', 'conversation'], conversationFields: ['threshold', 'cooldown'], selfServiceFields: ['threshold'] },
  properties: { overrides: { type: 'object' }, threshold: { type: 'integer', minimum: 2 }, cooldown: { type: 'integer' } },
};

function snapshot(): RuntimeSnapshot {
  const node = (id: PluginId, instanceKey: string, configSchema?: object) => ({ id, instanceKey, packageName: `@x/${instanceKey}`,
    packageRoot: `/x/${instanceKey}`, parent: id === root ? undefined : root, children: [], ...(configSchema ? { configSchema } : {}) });
  return {
    generation: 1, root, config: new Map(), resources: new Map(), capabilities: new Map(),
    tree: new Map([[root, node(root, 'root')], [repeater, node(repeater, 'repeater', repeaterSchema)], [rss, node(rss, 'rss')],
      [qq, node(qq, 'qq')], [tg, node(tg, 'tg')]]) as never,
    projections: new Map([[featureId('zhin.adapter'), {
      owner: (id: string) => id.startsWith('tg:') ? tg : qq,
      endpointEntry: (id: string) => ({ desired: { endpointId: id.split(':')[1] } }),
    }]]),
  };
}

const base: RuntimeConfigDocument = {
  configVersion: 2, plugins: { repeater: '@x/repeater', rss: '@x/rss', qq: '@x/qq', tg: '@x/tg' },
  qq: { endpoints: [{ id: 'bot-1' }, { id: 'bot-2' }] }, tg: { endpoints: [{ id: 'news' }] },
  repeater: { threshold: 3, overrides: { endpoints: { 'qq/bot-2': { enabled: false } } } },
};

const on: FeatureSelfServiceConfig = { ...DEFAULT_FEATURE_SELF_SERVICE, enabled: true };

function harness(config: FeatureSelfServiceConfig = on, owners: Record<string, string> = { 'qq/bot-1': 'boss' }, globalOwners: string[] = []) {
  const state = { document: structuredClone(base), revision: 1 };
  const patches: ConsoleConfigPatchRequest[] = [];
  const configuration = {
    async readProject() { return { revision: `r${state.revision}`, exists: true, value: structuredClone(state.document) }; },
    async patch(request: ConsoleConfigPatchRequest): Promise<ConsoleConfigPatchResult> {
      patches.push(request);
      state.document = applyConfigPatches(state.document, request.patches as never);
      state.revision += 1;
      return { status: 'saved', revision: `r${state.revision}`, restartRequired: false, paths: [], missingEnv: [], message: 'ok' };
    },
  };
  const conversations = new FeatureConversationOverrideStore();
  const roles = new ChatRoleService({ store: new ChatRoleStore(), sources: [
    createConfigChatRoleSource({ resolveOwner: (alias, id) => owners[`${alias}/${id}`], resolveTrusted: () => [],
      endpoints: () => Object.keys(owners).map(key => key.split('/') as [string, string]), globalOwners: () => globalOwners, globalTrusted: () => [] }),
    createPlatformChatRoleSource(() => platformMappingOf(config)),
  ] });
  const snap = snapshot();
  const audits: ConsoleAuditEntry[] = [];
  const setGlobalEnabled = vi.fn(async () => undefined);
  const deps = {
    config, roles, audit: (entry: ConsoleAuditEntry) => { audits.push(entry); }, pending: new Map(), code: () => '123456',
    context: { configuration, snapshots: { acquire: () => ({ value: snap, release() {} }) as never }, stores: { conversations }, setGlobalEnabled },
  };
  const run = (actor: FeatureChatActor | undefined, text: string, locale: 'zh-CN' | 'en' = 'zh-CN') =>
    executeFeatureChat({ tokens: text.split(' ').filter(Boolean), actor, locale }, deps);
  const role = (actor: FeatureChatActor | undefined, text: string) =>
    executeRoleChat({ tokens: text.split(' ').filter(Boolean), actor, locale: 'zh-CN' }, deps);
  return { run, role, conversations, roles, audits, state, patches, setGlobalEnabled, deps };
}

function actor(options: { user?: string; key?: string; standing?: 'owner' | 'admin' | 'member' } = {}): FeatureChatActor {
  const key = options.key ?? 'qq/bot-1/group:100';
  const [alias, endpointId] = key.split('/') as [string, string];
  return {
    identity: { adapter: alias, userId: options.user ?? 'u1' }, conversationKey: key, endpointKey: `${alias}/${endpointId}`,
    kind: key.includes('/private:') ? 'private' : 'group',
    context: { conversationKey: key, ...(options.standing ? { platform: { standing: options.standing } } : {}) },
  };
}

const DENIED = '你在该范围没有 admin 角色。';

describe('in-chat feature self-service (ADR 0055 §7, roles per ADR 0056)', () => {
  it('is off by default and reads features.selfService', async () => {
    expect(readFeatureSelfServiceConfig({})).toEqual(DEFAULT_FEATURE_SELF_SERVICE);
    expect(DEFAULT_FEATURE_SELF_SERVICE).toEqual({ enabled: false, platformAdmins: true, roles: ['owner', 'admin'] });
    expect(readFeatureSelfServiceConfig({ features: { selfService: { enabled: true, platformAdmins: false, roles: ['owner', 'member'] } } }))
      .toEqual({ enabled: true, platformAdmins: false, roles: ['owner'] });
    const { run, role } = harness(DEFAULT_FEATURE_SELF_SERVICE);
    expect(await run(actor({ standing: 'owner' }), '关闭 rss')).toContain('未开启');
    expect(await role(actor({ standing: 'owner' }), '列表')).toContain('未开启');
  });

  it('refuses senders without admin at the scope (platform mapping can be narrowed or off)', async () => {
    const { run, conversations } = harness();
    expect(await run(actor({ standing: 'member' }), '关闭 rss')).toBe(DENIED);
    expect(conversations.list()).toEqual([]);
    expect(await harness({ ...on, roles: ['owner'] }).run(actor({ standing: 'admin' }), '关闭 rss')).toBe(DENIED);
    expect(await harness({ ...on, platformAdmins: false }).run(actor({ standing: 'owner' }), '关闭 rss')).toBe(DENIED);
    // trusted is not enough.
    const trusted = harness();
    await trusted.roles.store.grant({ level: 'endpoint', key: 'qq/bot-1', adapter: 'qq', userId: 't', role: 'trusted' });
    expect(await trusted.run(actor({ user: 't' }), '关闭 rss')).toBe(DENIED);
  });

  it('lets a platform group admin manage only the current conversation, audited', async () => {
    const { run, conversations, audits } = harness();
    const admin = actor({ standing: 'admin' });
    expect(await run(admin, '关闭 rss')).toBe('已保存（会话层），立即生效。');
    expect(conversations.get('rss', 'qq/bot-1/group:100')).toMatchObject({ enabled: false, updatedBy: 'chat:qq:u1' });
    expect(audits.at(-1)).toMatchObject({ actor: 'chat:qq:u1', action: 'feature.chat:disable', target: 'conversation:qq/bot-1/group:100', outcome: 'ok',
      detail: { plugin: 'rss', level: 'conversation' } });
    expect(await run(admin, '关闭 rss 账号')).toBe(DENIED);
    expect(audits.at(-1)).toMatchObject({ outcome: 'denied', target: 'endpoint:qq/bot-1' });
    expect(await run(admin, 'enable rss conversation', 'en')).toBe('Saved (conversation level), effective now.');
    expect(conversations.get('rss', 'qq/bot-1/group:100')).toBeUndefined();
    // Private conversations: no conversation-level writes from chat.
    expect(await run(actor({ key: 'qq/bot-1/private:9', user: 'boss' }), '关闭 rss')).toContain('只能在 Console 修改');
  });

  it('limits field writes to selfServiceFields and validates values', async () => {
    const { run, conversations } = harness();
    const admin = actor({ standing: 'owner' });
    expect(await run(admin, '设置 repeater threshold 5')).toBe('已保存（会话层），立即生效。');
    expect(conversations.get('repeater', 'qq/bot-1/group:100')?.patch).toEqual({ threshold: 5 });
    expect(await run(admin, '设置 repeater cooldown 5')).toBe('字段 cooldown 不允许在聊天中修改。');
    expect(await run(admin, '设置 repeater threshold 1')).toContain('校验失败');
    expect(await run(admin, '设置 rss maxItems 1')).toBe('字段 maxItems 不允许在聊天中修改。');
    expect(await run(admin, '重置 repeater')).toBe('已保存（会话层），立即生效。');
    expect(conversations.get('repeater', 'qq/bot-1/group:100')).toBeUndefined();
  });

  it('refuses to enable or change a plugin locked above and names the level', async () => {
    const { run, conversations } = harness();
    const admin = actor({ key: 'qq/bot-2/group:5', standing: 'owner' });
    expect(await run(admin, '开启 repeater')).toBe('repeater 已在账号层停用，下级不能开启或修改开关。');
    expect(await run(admin, '关闭 repeater')).toBe('repeater 已在账号层停用，下级不能开启或修改开关。');
    expect(conversations.list()).toEqual([]);
    const list = await run(admin, '列表');
    expect(list).toContain('repeater：停用（账号层停用，已锁定）');
    expect(list).toContain('rss：启用');
    expect(list).toContain('你的角色：admin@会话 qq/bot-2/group:5');
  });

  it('treats the configured account owner as endpoint owner and writes the configuration file in place', async () => {
    const { run, state, patches } = harness();
    const owner = actor({ user: 'boss' });
    expect(await run(owner, '关闭 rss 账号')).toBe('已保存（账号层），立即生效。');
    expect((state.document.rss as any).overrides).toEqual({ endpoints: { 'qq/bot-1': { enabled: false } } });
    expect(patches).toHaveLength(1);
    expect(await run(owner, '关闭 rss 适配器')).toBe(DENIED);
    expect(await run(actor({ user: 'boss', key: 'qq/bot-2/group:1' }), '关闭 rss')).toBe(DENIED);
    expect(await run(owner, '开启 rss')).toBe('rss 已在账号层停用，下级不能开启或修改开关。');
  });

  it('inherits downward: an adapter admin manages its endpoints and conversations, not other adapters', async () => {
    const { run, roles, state, conversations } = harness();
    await roles.store.grant({ level: 'adapter', key: 'qq', adapter: 'qq', userId: 'alice', role: 'admin' });
    const alice = actor({ user: 'alice' });
    expect(await run(alice, '关闭 rss')).toBe('已保存（会话层），立即生效。');
    expect(await run(alice, '设置 repeater threshold 4 账号')).toBe('已保存（账号层），立即生效。');
    expect((state.document.repeater as any).overrides.endpoints['qq/bot-1']).toEqual({ threshold: 4 });
    expect(await run(alice, '关闭 rss 适配器')).toBe('已保存（适配器层），立即生效。');
    expect(await run(alice, '关闭 rss 全局')).toBe(DENIED);
    expect(await run(actor({ user: 'alice', key: 'tg/news/group:1' }), '关闭 rss')).toBe(DENIED);
    expect(conversations.list()).toHaveLength(1);
  });

  it('lets the same person hold different roles in different scopes', async () => {
    const { run, roles } = harness();
    await roles.store.grant({ level: 'endpoint', key: 'qq/bot-1', adapter: 'qq', userId: 'carol', role: 'admin' });
    await roles.store.grant({ level: 'conversation', key: 'qq/bot-2/group:9', adapter: 'qq', userId: 'carol', role: 'admin' });
    expect(await run(actor({ user: 'carol', key: 'qq/bot-1/group:1' }), '关闭 rss 账号')).toBe('已保存（账号层），立即生效。');
    expect(await run(actor({ user: 'carol', key: 'qq/bot-2/group:9' }), '关闭 rss')).toBe('已保存（会话层），立即生效。');
    expect(await run(actor({ user: 'carol', key: 'qq/bot-2/group:9' }), '关闭 rss 账号')).toBe(DENIED);
    expect(await run(actor({ user: 'carol', key: 'qq/bot-2/group:8' }), '关闭 rss')).toBe(DENIED);
  });

  it('requires an explicit confirmation for global switches and restarts', async () => {
    const { run, setGlobalEnabled, audits } = harness(on, {}, ['root']);
    const admin = actor({ user: 'root' });
    expect(await run(admin, '关闭 rss 全局')).toBe('全局停用 rss 会重启实例。确认请在 2 分钟内发送：功能 确认 123456');
    expect(setGlobalEnabled).not.toHaveBeenCalled();
    expect(await run(admin, '确认 000000')).toBe('没有待确认的操作，或确认码已过期。');
    expect(await run(actor({ user: 'other', standing: 'owner' }), '确认 123456')).toBe('没有待确认的操作，或确认码已过期。');
    expect(await run(admin, '确认 123456')).toBe('已停用 rss（全局），实例正在重启。');
    expect(setGlobalEnabled).toHaveBeenCalledWith('rss', false);
    expect(audits.at(-1)).toMatchObject({ action: 'feature.chat:disable', target: 'global:', outcome: 'ok' });
    expect(await run(admin, '确认 123456')).toBe('没有待确认的操作，或确认码已过期。');
  });
});

describe('in-chat role management (ADR 0056 §3)', () => {
  it('grants at or below the grantor role; owner only from an owner above', async () => {
    const { role, roles, audits } = harness();
    const groupAdmin = actor({ standing: 'owner' });
    expect(await role(groupAdmin, '授予 dave trusted')).toBe('已保存（会话层），立即生效。');
    expect(await role(groupAdmin, '授予 dave admin')).toBe('已保存（会话层），立即生效。');
    expect(roles.store.list()).toMatchObject([{ level: 'conversation', key: 'qq/bot-1/group:100', adapter: 'qq', userId: 'dave', role: 'admin', grantedBy: 'chat:qq:u1' }]);
    expect(await role(groupAdmin, '授予 dave owner')).toBe('你在该范围的角色不足以授予或撤销 owner。');
    expect(await role(groupAdmin, '授予 erin admin 账号')).toBe('你在该范围的角色不足以授予或撤销 admin。');
    expect(audits.at(-1)).toMatchObject({ action: 'chat-roles.chat:grant', outcome: 'denied', target: 'endpoint:qq/bot-1' });
    // The configured endpoint owner may grant owner below the endpoint, not at it.
    const owner = actor({ user: 'boss' });
    expect(await role(owner, '授予 frank owner')).toBe('已保存（会话层），立即生效。');
    expect(await role(owner, '授予 frank owner 账号')).toBe('owner 只能由更高层的 owner 授予或撤销。');
    // A conversation owner cannot grant owner in its own conversation (needs an owner above).
    expect(await role(actor({ user: 'frank' }), '授予 gina owner')).toBe('owner 只能由更高层的 owner 授予或撤销。');
    expect(await role(actor({ user: 'frank' }), '授予 gina admin')).toBe('已保存（会话层），立即生效。');
    const tokens = featureChatTokens({ segments: [{ type: 'text', data: { text: '撤销 ' } }, { type: 'at', data: { user_id: 'dave' } }, { type: 'text', data: { text: ' admin' } }], args: [] });
    expect(tokens).toEqual(['撤销', { user: 'dave' }, 'admin']);
    expect(await executeRoleChat({ tokens, actor: actor({ user: 'dave' }), locale: 'zh-CN' }, harness().deps)).toBe('你在该范围的角色不足以授予或撤销 admin。');
    expect(await executeRoleChat({ tokens, actor: groupAdmin, locale: 'zh-CN' }, { ...harness().deps, roles })).toBe('已保存（会话层），立即生效。');
    expect(roles.store.list().map(entry => entry.userId)).toEqual(['frank', 'gina']);
    // Revoking an owner needs an owner above.
    expect(await role(groupAdmin, '撤销 frank owner')).toBe('你在该范围的角色不足以授予或撤销 owner。');
    expect(await role(owner, '撤销 frank owner')).toBe('已保存（会话层），立即生效。');
    const listed = await role(groupAdmin, '列表');
    expect(listed).toContain('admin @ 会话 qq/bot-1/group:100：qq:gina（grant）');
    expect(listed).toContain('owner @ 账号 qq/bot-1：qq:boss（config）');
    expect(listed).toContain('你的角色：admin@会话 qq/bot-1/group:100');
  });

  it('resolves the actor from a message', () => {
    const resolved = featureChatActor(snapshot(), { conversation: { kind: 'group', id: '100', endpoint: { id: 'qq:bot-1', adapter: 'qq' } },
      sender: { id: 'u1', roles: ['master', 'owner'] } });
    expect(resolved).toEqual({ identity: { adapter: 'qq', userId: 'u1' }, conversationKey: 'qq/bot-1/group:100', endpointKey: 'qq/bot-1',
      kind: 'group', context: { conversationKey: 'qq/bot-1/group:100', platform: { standing: 'owner' } } });
    expect(featureChatActor(snapshot(), { conversation: { endpoint: { id: 'qq:bot-1' } }, sender: { id: 'u1' } })).toBeUndefined();
  });
});
