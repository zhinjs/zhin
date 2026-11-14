import { describe, expect, it, vi } from 'vitest';
import {
  applyConfigPatches, childPluginId, featureId, rootPluginId,
  type PluginId, type RuntimeConfigDocument, type RuntimeSnapshot,
} from '@zhin.js/plugin-runtime';
import type { ConsoleConfigPatchRequest, ConsoleConfigPatchResult } from '@zhin.js/console-protocol';
import type { ConsoleAuditEntry } from '@zhin.js/host-http';
import { FeatureOverrideStore } from '../../src/instance/console/feature-override-store.js';
import {
  ChatRoleService, ChatRoleStore, type InstanceChatRoleService,
} from '../../src/instance/chat-roles.js';
import {
  DEFAULT_FEATURE_SELF_SERVICE, executeFeatureChat, executeRoleChat, featureChatActor, featureChatTokens,
  readFeatureSelfServiceConfig,
  type FeatureChatActor, type FeatureSelfServiceConfig,
} from '../../src/instance/feature-self-service.js';

const root = rootPluginId();
const repeater = childPluginId(root, 'repeater');
const rss = childPluginId(root, 'rss');
const qq = childPluginId(root, 'qq');
const tg = childPluginId(root, 'tg');
const cache = childPluginId(root, 'cache');
const tgOnly = childPluginId(root, 'tg-only');
const welcome = childPluginId(root, 'welcome');
const games = childPluginId(root, 'games');
const gamesRps = childPluginId(games, 'rps');

const repeaterSchema = {
  type: 'object', additionalProperties: false,
  'x-zhin-config': { levels: ['global', 'adapter', 'endpoint', 'conversation'], conversationFields: ['threshold', 'cooldown', 'greeting'], selfServiceFields: ['threshold', 'greeting'] },
  properties: { overrides: { type: 'object' }, threshold: { type: 'integer', minimum: 2 }, cooldown: { type: 'integer' }, greeting: { type: 'string' } },
};

function snapshot(qqConfig: unknown = {}, extra = 0): RuntimeSnapshot {
  const node = (id: PluginId, instanceKey: string, configSchema?: object) => ({ id, instanceKey, packageName: `@x/${instanceKey}`,
    packageRoot: `/x/${instanceKey}`, parent: id === root ? undefined : root, children: [], ...(configSchema ? { configSchema } : {}) });
  const slot = (owner: PluginId, feature: string, localName: string, definition: object = {}) =>
    [`${owner}:${feature}:${localName}`, { id: `${owner}:${feature}:${localName}`, owner, feature, localName, definition }] as const;
  const extras = Array.from({ length: extra }, (_, index) => childPluginId(root, `extra-${String(index).padStart(2, '0')}`));
  return {
    generation: 1, root, config: new Map<PluginId, unknown>([[qq, qqConfig], [welcome, { enabled: false }]]), resources: new Map(),
    // Chat-facing capabilities decide what `功能 列表` shows; adapters and service-only plugins have none.
    capabilities: new Map([
      slot(repeater, 'zhin.middleware', 'repeat'), slot(rss, 'zhin.command', 'rss'), slot(welcome, 'zhin.handler', 'notice/group'),
      slot(tgOnly, 'zhin.command', 'sticker', { adapter: 'telegram' }), slot(gamesRps, 'zhin.command', 'rps'),
      slot(cache, 'zhin.tool', 'lookup'), slot(qq, 'zhin.adapter', 'qq'), slot(tg, 'zhin.adapter', 'tg'),
      ...extras.map(id => slot(id, 'zhin.command', 'run')),
    ]) as never,
    tree: new Map([[root, node(root, 'root')], [repeater, node(repeater, 'repeater', repeaterSchema)], [rss, node(rss, 'rss')],
      [qq, node(qq, 'qq')], [tg, node(tg, 'tg')], [cache, node(cache, 'cache')], [tgOnly, node(tgOnly, 'tg-only')],
      [welcome, node(welcome, 'welcome')], [games, { ...node(games, 'games'), children: [gamesRps] }],
      [gamesRps, { id: gamesRps, instanceKey: 'rps', packageName: '@x/rps', packageRoot: '/x/rps', parent: games, children: [] }],
      ...extras.map(id => [id, node(id, id.split('/').at(-1)!)] as const)]) as never,
    projections: new Map([[featureId('zhin.adapter'), {
      owner: (id: string) => id.startsWith('tg:') ? tg : qq,
      endpointEntry: (id: string) => ({ desired: { endpointId: id.split(':')[1] } }),
    }]]),
  };
}

const base: RuntimeConfigDocument = {
  configVersion: 2, plugins: { repeater: '@x/repeater', rss: '@x/rss', qq: '@x/qq', tg: '@x/tg', cache: '@x/cache', 'tg-only': '@x/tg-only',
    welcome: '@x/welcome', games: '@x/games', old: '@x/old' },
  disable_plugins: ['old'], welcome: { enabled: false },
  qq: { endpoints: [{ id: 'bot-1' }, { id: 'bot-2' }] }, tg: { endpoints: [{ id: 'news' }] },
  repeater: { threshold: 3 },
};

const on: FeatureSelfServiceConfig = { ...DEFAULT_FEATURE_SELF_SERVICE, enabled: true };

let current = snapshot();

async function harness(config: FeatureSelfServiceConfig = on, owners: Record<string, string> = { 'qq/bot-1': 'boss' }, globalOwners: string[] = [],
  conversations: FeatureOverrideStore = new FeatureOverrideStore(), extra = 0) {
  // ADR 0057 §2: the endpoint level lives in the override store (repeater is off on qq/bot-2).
  conversations.seed([{ plugin: 'repeater', key: 'qq/bot-2', enabled: false, patch: {} }]);
  const document = structuredClone(base);
  for (let index = 0; index < extra; index += 1) (document.plugins as Record<string, string>)[`extra-${String(index).padStart(2, '0')}`] = '@x/extra';
  const state = { document, revision: 1 };
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
  const roles: InstanceChatRoleService = new ChatRoleService({ store: new ChatRoleStore() });
  for (const [key, userId] of Object.entries(owners)) await roles.store.grant({ level: 'endpoint', key, adapter: key.split('/')[0]!, userId, role: 'owner' });
  for (const userId of globalOwners) await roles.store.grant({ level: 'global', key: '', adapter: 'qq', userId, role: 'owner' });
  const snap = snapshot({}, extra);
  current = snap;
  const audits: ConsoleAuditEntry[] = [];
  const setGlobalEnabled = vi.fn(async () => undefined);
  const deps = {
    config, roles, audit: (entry: ConsoleAuditEntry) => { audits.push(entry); }, pending: new Map(), code: () => '123456',
    context: { configuration, snapshots: { acquire: () => ({ value: snap, release() {} }) as never }, stores: { overrides: conversations }, setGlobalEnabled },
  };
  const run = (actor: FeatureChatActor | undefined, text: string, locale: 'zh-CN' | 'en' = 'zh-CN', clientAdapter?: string) =>
    executeFeatureChat({ tokens: text.split(' ').filter(Boolean), actor, locale, ...(clientAdapter ? { clientAdapter } : {}) }, deps);
  /** As the installed command parses it: quote-aware tokens from the message text. */
  const say = (actor: FeatureChatActor | undefined, text: string) =>
    executeFeatureChat({ tokens: featureChatTokens({ segments: [{ type: 'text', data: { text } }], args: [] }), actor, locale: 'zh-CN' }, deps);
  const role = (actor: FeatureChatActor | undefined, text: string) =>
    executeRoleChat({ tokens: text.split(' ').filter(Boolean), actor, locale: 'zh-CN' }, deps);
  return { run, say, role, conversations, roles, audits, state, patches, setGlobalEnabled, deps };
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

/** zhin roles come only from grants: make `user` a conversation admin (ADR 0056 §4, revised 2026-11-12). */
async function promote(roles: InstanceChatRoleService, user = 'u1', key = 'qq/bot-1/group:100') {
  await roles.store.grant({ level: 'conversation', key, adapter: key.split('/')[0]!, userId: user, role: 'admin' });
}

describe('in-chat feature self-service (ADR 0055 §7, roles per ADR 0056)', () => {
  it('is off by default and reads features.selfService', async () => {
    expect(readFeatureSelfServiceConfig({})).toEqual(DEFAULT_FEATURE_SELF_SERVICE);
    expect(DEFAULT_FEATURE_SELF_SERVICE).toEqual({ enabled: false });
    expect(readFeatureSelfServiceConfig({ features: { selfService: { enabled: true } } })).toEqual({ enabled: true });
    const { run, role } = await harness(DEFAULT_FEATURE_SELF_SERVICE);
    expect(await run(actor({ standing: 'owner' }), '关闭 rss')).toContain('未开启');
    expect(await role(actor({ standing: 'owner' }), '列表')).toContain('未开启');
  });

  it('refuses senders without zhin admin at the scope; platform group owners / admins get nothing', async () => {
    const { run, conversations } = await harness();
    expect(await run(actor({ standing: 'member' }), '关闭 rss')).toBe(DENIED);
    // Platform standing is a separate dimension and never becomes a zhin role.
    expect(await run(actor({ standing: 'admin' }), '关闭 rss')).toBe(DENIED);
    expect(await run(actor({ standing: 'owner' }), '关闭 rss')).toBe(DENIED);
    expect(conversations.list('conversation')).toEqual([]);
    // trusted is not enough.
    const trusted = await harness();
    await trusted.roles.store.grant({ level: 'endpoint', key: 'qq/bot-1', adapter: 'qq', userId: 't', role: 'trusted' });
    expect(await trusted.run(actor({ user: 't' }), '关闭 rss')).toBe(DENIED);
  });

  it('lets a conversation admin manage only the current conversation, audited', async () => {
    const { run, conversations, audits, roles } = await harness();
    await promote(roles);
    const admin = actor({ standing: 'admin' });
    expect(await run(admin, '关闭 rss')).toBe('已保存（会话层），立即生效。');
    expect(conversations.get('rss', 'qq/bot-1/group:100')).toMatchObject({ enabled: false, updatedBy: 'chat:qq:u1',
      operator: { source: 'chat', adapter: 'qq', userId: 'u1' } });
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
    const { run, conversations, roles } = await harness();
    await promote(roles);
    const admin = actor({ standing: 'owner' });
    expect(await run(admin, '设置 repeater threshold 5')).toBe('已保存（会话层），立即生效。');
    expect(conversations.get('repeater', 'qq/bot-1/group:100')?.patch).toEqual({ threshold: 5 });
    expect(await run(admin, '设置 repeater cooldown 5')).toBe('字段 cooldown 不允许在聊天中修改。');
    expect(await run(admin, '设置 repeater threshold 1')).toContain('校验失败');
    expect(await run(admin, '设置 rss maxItems 1')).toBe('字段 maxItems 不允许在聊天中修改。');
    expect(await run(admin, '重置 repeater')).toBe('已保存（会话层），立即生效。');
    expect(conversations.get('repeater', 'qq/bot-1/group:100')).toBeUndefined();
  });

  it('refuses writes when the project database cannot persist overrides (memory, MongoDB, Redis), at every stored level', async () => {
    const store = new FeatureOverrideStore({ database: { dialect: 'mongodb', started: true, models: { get: () => undefined } } as never });
    await store.load();
    const { run, roles, patches } = await harness(on, { 'qq/bot-1': 'boss' }, [], store);
    await promote(roles);
    const refused = '未保存：功能覆盖需要关系型项目数据库（sqlite / mysql / pg），当前数据库不支持持久化。';
    expect(await run(actor(), '关闭 rss')).toBe(refused);
    expect(await run(actor(), '关闭 rss', 'en')).toBe('Not saved: feature overrides need a relational project database (sqlite / mysql / pg); the current database cannot persist them.');
    expect(await run(actor({ user: 'boss' }), '关闭 rss 账号')).toBe(refused);
    expect(store.list('conversation')).toEqual([]);
    expect(store.get('rss', 'qq/bot-1')).toBeUndefined();
    expect(patches).toEqual([]);
  });

  it('never plants environment references from chat, at any level', async () => {
    const { run, conversations, roles, patches, deps } = await harness(on, { 'qq/bot-1': 'boss' }, ['root']);
    await promote(roles);
    const refused = '聊天中不能写入环境变量引用（$ 加花括号的占位符或 env://），未保存。';
    // Even a Console-side allowance on the shared context is never inherited by chat.
    (deps.context as Record<string, unknown>).mayReferenceEnvironment = () => true;
    expect(await run(actor(), '设置 repeater threshold ${SECRET}')).toBe(refused);
    expect(await run(actor({ user: 'boss' }), '设置 repeater threshold ${SECRET} 账号')).toBe(refused);
    expect(await run(actor({ user: 'root' }), '设置 repeater threshold env://SECRET 全局')).toBe(refused);
    expect(await run(actor({ user: 'root' }), '设置 repeater threshold ["${A:-x}"] 适配器')).toBe(refused);
    expect(conversations.list('conversation')).toEqual([]);
    expect(patches).toEqual([]);
  });

  it('refuses to enable or change a plugin locked above and names the level', async () => {
    const { run, conversations, roles } = await harness();
    await promote(roles, 'u1', 'qq/bot-2/group:5');
    const admin = actor({ key: 'qq/bot-2/group:5', standing: 'owner' });
    expect(await run(admin, '开启 repeater')).toBe('repeater 已在账号层停用，下级不能开启或修改开关。');
    expect(await run(admin, '关闭 repeater')).toBe('repeater 已在账号层停用，下级不能开启或修改开关。');
    expect(conversations.list('conversation')).toEqual([]);
    const list = await run(admin, '列表');
    expect(list).toContain('repeater：停用（账号层停用，已锁定）');
    expect(list).toContain('rss：启用');
    expect(list).toContain('你的角色：admin@会话 qq/bot-2/group:5');
  });

  it('treats a stored account owner as endpoint owner and writes the override store, not the configuration file', async () => {
    const { run, state, patches, conversations } = await harness();
    const owner = actor({ user: 'boss' });
    expect(await run(owner, '关闭 rss 账号')).toBe('已保存（账号层），立即生效。');
    expect(conversations.get('rss', 'qq/bot-1')).toMatchObject({ level: 'endpoint', enabled: false, patch: {}, updatedBy: 'chat:qq:boss' });
    expect(state.document.rss).toBeUndefined();
    expect(patches).toEqual([]);
    expect(await run(owner, '关闭 rss 适配器')).toBe(DENIED);
    expect(await run(actor({ user: 'boss', key: 'qq/bot-2/group:1' }), '关闭 rss')).toBe(DENIED);
    expect(await run(owner, '开启 rss')).toBe('rss 已在账号层停用，下级不能开启或修改开关。');
  });

  it('inherits downward: an adapter admin manages its endpoints and conversations, not other adapters', async () => {
    const { run, roles, state, conversations } = await harness();
    await roles.store.grant({ level: 'adapter', key: 'qq', adapter: 'qq', userId: 'alice', role: 'admin' });
    const alice = actor({ user: 'alice' });
    expect(await run(alice, '关闭 rss')).toBe('已保存（会话层），立即生效。');
    expect(await run(alice, '设置 repeater threshold 4 账号')).toBe('已保存（账号层），立即生效。');
    expect(conversations.get('repeater', 'qq/bot-1')?.patch).toEqual({ threshold: 4 });
    expect(state.document.repeater).toEqual({ threshold: 3 });
    expect(await run(alice, '关闭 rss 适配器')).toBe('已保存（适配器层），立即生效。');
    expect(conversations.get('rss', 'qq')).toMatchObject({ level: 'adapter', enabled: false });
    expect(await run(alice, '关闭 rss 全局')).toBe(DENIED);
    expect(await run(actor({ user: 'alice', key: 'tg/news/group:1' }), '关闭 rss')).toBe(DENIED);
    expect(conversations.list('conversation')).toHaveLength(1);
  });

  it('lets the same person hold different roles in different scopes', async () => {
    const { run, roles } = await harness();
    await roles.store.grant({ level: 'endpoint', key: 'qq/bot-1', adapter: 'qq', userId: 'carol', role: 'admin' });
    await roles.store.grant({ level: 'conversation', key: 'qq/bot-2/group:9', adapter: 'qq', userId: 'carol', role: 'admin' });
    expect(await run(actor({ user: 'carol', key: 'qq/bot-1/group:1' }), '关闭 rss 账号')).toBe('已保存（账号层），立即生效。');
    expect(await run(actor({ user: 'carol', key: 'qq/bot-2/group:9' }), '关闭 rss')).toBe('已保存（会话层），立即生效。');
    expect(await run(actor({ user: 'carol', key: 'qq/bot-2/group:9' }), '关闭 rss 账号')).toBe(DENIED);
    expect(await run(actor({ user: 'carol', key: 'qq/bot-2/group:8' }), '关闭 rss')).toBe(DENIED);
  });

  it('takes quoted values and the rest of the text as the value of 设置 (#1250)', async () => {
    const { say, conversations, roles } = await harness();
    await promote(roles);
    const admin = actor();
    expect(featureChatTokens({ segments: [{ type: 'text', data: { text: '设置 repeater greeting "欢迎 {name}" 账号' } }], args: [] }))
      .toEqual(['设置', 'repeater', 'greeting', '欢迎 {name}', '账号']);
    expect(featureChatTokens({ segments: [{ type: 'text', data: { text: '设置 a b \u201C你好 世界\u201D \u300C一 二\u300D \'x y\'' } }], args: [] }))
      .toEqual(['设置', 'a', 'b', '你好 世界', '一 二', 'x y']);
    expect(await say(admin, '设置 repeater greeting "欢迎 {name}"')).toBe('已保存（会话层），立即生效。');
    expect(conversations.get('repeater', 'qq/bot-1/group:100')?.patch).toEqual({ greeting: '欢迎 {name}' });
    expect(await say(admin, '设置 repeater greeting \u201C欢迎新人 {name}\u201D')).toBe('已保存（会话层），立即生效。');
    expect(conversations.get('repeater', 'qq/bot-1/group:100')?.patch).toEqual({ greeting: '欢迎新人 {name}' });
    // Unquoted: everything after the field is the value; a trailing level word is still the level.
    expect(await say(admin, '设置 repeater greeting 欢迎 大家 光临')).toBe('已保存（会话层），立即生效。');
    expect(conversations.get('repeater', 'qq/bot-1/group:100')?.patch).toEqual({ greeting: '欢迎 大家 光临' });
    expect(await say(admin, '设置 repeater greeting 欢迎 {name} 账号')).toBe(DENIED);
    expect(await say(admin, '设置 repeater greeting "会话"')).toBe('已保存（会话层），立即生效。');
    expect(conversations.get('repeater', 'qq/bot-1/group:100')?.patch).toEqual({ greeting: '会话' });
    expect(await say(admin, '设置 repeater greeting')).toContain('用法');
  });

  it('lists only chat-facing plugins for this conversation, with configuration and global switches, paginated (#1250)', async () => {
    const { run } = await harness();
    const owner = actor({ user: 'boss' });
    const list = await run(owner, '列表', 'zh-CN', 'icqq');
    expect(list).toContain('rss：启用');
    expect(list).toContain('repeater：启用');
    expect(list).toContain('games：启用');
    expect(list).toContain('games/rps：启用');
    expect(list).toContain('welcome：停用（配置 enabled: false）');
    expect(list).toContain('old：停用（全局停用）');
    // Adapters, service-only plugins and plugins whose commands target another platform are not listed.
    for (const hidden of ['qq：', 'tg：', 'cache：', 'tg-only：']) expect(list).not.toContain(hidden);
    expect(list).not.toContain('第 1/');
    // The same plugin applies where its adapter matches.
    expect(await run(owner, '列表', 'zh-CN', 'telegram')).toContain('tg-only：启用');
    expect(await run(owner, '列表 x')).toContain('用法');
    expect(await run(owner, '列表 2')).toBe('页码超出范围：共 1 页。请使用「功能 列表 <页码>」。');
  });

  it('pages a long feature list in the command-menu style', async () => {
    const { run } = await harness(on, { 'qq/bot-1': 'boss' }, [], new FeatureOverrideStore(), 20);
    const owner = actor({ user: 'boss' });
    const first = await run(owner, '列表');
    expect(first).toContain('第 1/2 页 · 共 27 项');
    expect(first).toContain('下一页：功能 列表 2');
    expect(first.split('\n').filter(line => /：(启用|停用)/u.test(line)).length).toBe(15);
    const second = await run(owner, '列表 2');
    expect(second).toContain('第 2/2 页 · 共 27 项');
    expect(second).not.toContain('下一页');
    expect(second).toContain('你的角色：');
  });

  it('requires an explicit confirmation for global switches and restarts', async () => {
    const { run, setGlobalEnabled, audits, roles } = await harness(on, {}, ['root']);
    await promote(roles, 'other');
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
    const { role, roles, audits } = await harness();
    await promote(roles);
    const groupAdmin = actor({ standing: 'owner' });
    expect(await role(groupAdmin, '授予 dave trusted')).toBe('已保存（会话层），立即生效。');
    expect(await role(groupAdmin, '授予 dave admin')).toBe('已保存（会话层），立即生效。');
    expect(roles.store.list().filter(entry => entry.userId === 'dave')).toMatchObject([{ level: 'conversation', key: 'qq/bot-1/group:100', adapter: 'qq', userId: 'dave', role: 'admin', grantedBy: 'chat:qq:u1' }]);
    expect(await role(groupAdmin, '授予 dave owner')).toBe('你在该范围的角色不足以授予或撤销 owner。');
    expect(await role(groupAdmin, '授予 erin admin 账号')).toBe('你在该范围的角色不足以授予或撤销 admin。');
    expect(audits.at(-1)).toMatchObject({ action: 'chat-roles.chat:grant', outcome: 'denied', target: 'endpoint:qq/bot-1' });
    // The stored endpoint owner may grant owner below the endpoint, not at it.
    const owner = actor({ user: 'boss' });
    expect(await role(owner, '授予 frank owner')).toBe('已保存（会话层），立即生效。');
    expect(await role(owner, '授予 frank owner 账号')).toBe('owner 只能由更高层的 owner 授予或撤销。');
    // A conversation owner cannot grant owner in its own conversation (needs an owner above).
    expect(await role(actor({ user: 'frank' }), '授予 gina owner')).toBe('owner 只能由更高层的 owner 授予或撤销。');
    expect(await role(actor({ user: 'frank' }), '授予 gina admin')).toBe('已保存（会话层），立即生效。');
    const tokens = featureChatTokens({ segments: [{ type: 'text', data: { text: '撤销 ' } }, { type: 'at', data: { user_id: 'dave' } }, { type: 'text', data: { text: ' admin' } }], args: [] });
    expect(tokens).toEqual(['撤销', { user: 'dave' }, 'admin']);
    expect(await executeRoleChat({ tokens, actor: actor({ user: 'dave' }), locale: 'zh-CN' }, (await harness()).deps)).toBe('你在该范围的角色不足以授予或撤销 admin。');
    // dave is now a peer admin of the grantor: only a higher role or an admin above may revoke it.
    expect(await executeRoleChat({ tokens, actor: groupAdmin, locale: 'zh-CN' }, { ...(await harness()).deps, roles }))
      .toBe('对方在该范围已是 admin，与你同级；只有更高的角色或更高层的 admin 才能修改或撤销。');
    expect(await executeRoleChat({ tokens, actor: owner, locale: 'zh-CN' }, { ...(await harness()).deps, roles })).toBe('已保存（会话层），立即生效。');
    expect(roles.store.list().map(entry => entry.userId)).toEqual(['boss', 'u1', 'frank', 'gina']);
    // Revoking an owner needs an owner above.
    expect(await role(groupAdmin, '撤销 frank owner')).toBe('你在该范围的角色不足以授予或撤销 owner。');
    expect(await role(owner, '撤销 frank owner')).toBe('已保存（会话层），立即生效。');
    const listed = await role(groupAdmin, '列表');
    expect(listed).toContain('admin @ 会话 qq/bot-1/group:100：qq:gina（grant）');
    // Granted above the scopes the actor administers: role and level only, no identity.
    expect(listed).toContain('owner @ 账号 qq/bot-1：（上级授予，身份不显示）（grant）');
    expect(listed).not.toContain('qq:boss');
    expect(listed).not.toContain('standing=');
    expect(listed).toContain('你的角色：admin@会话 qq/bot-1/group:100');
  });

  it('never lets a lower grant overwrite a higher or peer role at the same scope (review: demote)', async () => {
    const { role, roles, audits } = await harness();
    const key = 'qq/bot-1/group:100';
    await roles.store.grant({ level: 'conversation', key, adapter: 'qq', userId: 'victim', role: 'owner' });
    await promote(roles, 'attacker');
    await promote(roles, 'peer');
    const attacker = actor({ user: 'attacker' });
    expect(await role(attacker, 'revoke victim owner')).toBe('你在该范围的角色不足以授予或撤销 owner。');
    expect(await role(attacker, 'grant victim trusted')).toBe('你在该范围的角色不足以授予或撤销 owner。');
    expect(roles.store.get('conversation', key, { adapter: 'qq', userId: 'victim' })?.role).toBe('owner');
    expect(await role(attacker, 'grant peer trusted')).toBe('对方在该范围已是 admin，与你同级；只有更高的角色或更高层的 admin 才能修改或撤销。');
    expect(await role(attacker, 'revoke peer admin')).toBe('对方在该范围已是 admin，与你同级；只有更高的角色或更高层的 admin 才能修改或撤销。');
    expect(roles.store.get('conversation', key, { adapter: 'qq', userId: 'peer' })?.role).toBe('admin');
    expect(audits.at(-1)).toMatchObject({ outcome: 'denied', detail: { role: 'admin', reason: 'peer' } });
    // Granting a new admin next to oneself is still fine, and so is re-granting the same role.
    expect(await role(attacker, 'grant newbie admin')).toBe('已保存（会话层），立即生效。');
    expect(await role(attacker, 'grant peer admin')).toBe('没有变化。');
    // The same role held at a higher level, or a higher role, may change a peer's grant.
    await roles.store.grant({ level: 'endpoint', key: 'qq/bot-1', adapter: 'qq', userId: 'boss2', role: 'admin' });
    expect(await role(actor({ user: 'boss2' }), 'grant peer trusted')).toBe('已保存（会话层），立即生效。');
    expect(await role(actor({ user: 'boss' }), 'grant victim admin')).toBe('已保存（会话层），立即生效。');
    expect(roles.store.get('conversation', key, { adapter: 'qq', userId: 'victim' })?.role).toBe('admin');
  });

  it('lists roles only for admins and hides identities granted above them', async () => {
    const { role, roles } = await harness({ ...on }, { 'qq/bot-1': 'boss' }, ['root']);
    await promote(roles);
    expect(await role(actor({ user: 'nobody' }), '列表')).toBe('查看角色列表需要本会话的 admin 角色。');
    const listed = await role(actor(), '列表');
    expect(listed).toContain('admin @ 会话 qq/bot-1/group:100：qq:u1（grant）');
    expect(listed).toContain('owner @ 全局 *：（上级授予，身份不显示）（grant）');
    expect(listed).not.toContain('qq:root');
    // A global owner sees everyone.
    expect(await role(actor({ user: 'root' }), '列表')).toContain('qq:boss');
  });

  it('refuses grants and revocations it cannot persist instead of answering saved', async () => {
    const { deps } = await harness();
    const database = { dialect: 'memory', started: true, models: new Map() } as never;
    const roles: InstanceChatRoleService = new ChatRoleService({ store: new ChatRoleStore({ database }) });
    roles.store.seed([{ level: 'endpoint', key: 'qq/bot-1', adapter: 'qq', userId: 'boss', role: 'owner' }]);
    expect(roles.store.persistent).toBe(false);
    const reply = await executeRoleChat({ tokens: ['grant', 'dave', 'admin'], actor: actor({ user: 'boss' }), locale: 'zh-CN' }, { ...deps, roles });
    expect(reply).toBe('未保存：聊天角色需要关系型项目数据库（sqlite / mysql / pg），当前数据库不支持持久化。');
    await expect(roles.store.revoke({ level: 'endpoint', key: 'qq/bot-1', adapter: 'qq', userId: 'boss' })).rejects.toMatchObject({ code: 'chat-roles-unpersisted' });
    expect(roles.store.list()).toHaveLength(1);
  });

  it('resolves the actor from a message', () => {
    const resolved = featureChatActor(snapshot(), { conversation: { kind: 'group', id: '100', endpoint: { id: 'qq:bot-1', adapter: 'qq' } },
      sender: { id: 'u1', platform: { standing: 'owner' } } });
    expect(resolved).toEqual({ identity: { adapter: 'qq', userId: 'u1' }, conversationKey: 'qq/bot-1/group:100', endpointKey: 'qq/bot-1',
      kind: 'group', context: { conversationKey: 'qq/bot-1/group:100', platform: { standing: 'owner' } } });
    expect(featureChatActor(snapshot(), { conversation: { endpoint: { id: 'qq:bot-1' } }, sender: { id: 'u1' } })).toBeUndefined();
    // The sender's display name is kept for the override record; a name that only repeats the id is not.
    expect(featureChatActor(snapshot(), { conversation: { kind: 'group', id: '100', endpoint: { id: 'qq:bot-1', adapter: 'qq' } },
      sender: { id: 'u1', name: ' 小明 ' } })?.displayName).toBe('小明');
    expect(featureChatActor(snapshot(), { conversation: { kind: 'group', id: '100', endpoint: { id: 'qq:bot-1', adapter: 'qq' } },
      sender: { id: 'u1', name: 'u1' } })).not.toHaveProperty('displayName');
  });

  it('records who changed an override from chat and that it came from chat (#1250)', async () => {
    const { run, conversations, roles } = await harness();
    await promote(roles);
    expect(await run({ ...actor(), displayName: '小明' }, '关闭 repeater')).toBe('已保存（会话层），立即生效。');
    expect(conversations.get('repeater', 'qq/bot-1/group:100')).toMatchObject({ updatedBy: 'chat:qq:u1',
      operator: { source: 'chat', adapter: 'qq', userId: 'u1', displayName: '小明' } });
  });
});
