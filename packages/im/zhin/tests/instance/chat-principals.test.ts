import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabaseHost } from '@zhin.js/core/runtime';
import { createChatRoleReader } from '@zhin.js/core';
import { authorizeConsoleRpc, type ConsolePrincipal } from '@zhin.js/host-http';
import { CHAT_PRINCIPALS_RPC, CHAT_ROLES_RPC, CONSOLE_BUILTIN_ROLES } from '@zhin.js/console-protocol';
import {
  CHAT_ROLE_BACKUP_DIRECTORY, ChatRoleService, ChatRoleStore, defineChatRoleTable, type InstanceChatRoleService,
} from '../../src/instance/chat-roles.js';
import {
  CHAT_IDENTITY_RETENTION_MS, CHAT_IDENTITY_SIGHTING_THROTTLE_MS, defineChatPrincipalTables, isChatPrincipalId, newChatPrincipalId,
} from '../../src/instance/chat-principals.js';
import { ChatPeople } from '../../src/instance/chat-people.js';
import { CHAT_BIND_MAX_FAILURES, ChatIdentityBindCodes, executeIdentityBind } from '../../src/instance/chat-identity-bind.js';
import { chatGrantorName, dispatchChatPrincipalsConsoleRpc, type ChatPrincipalsRpcContext } from '../../src/instance/console/chat-principals-rpc.js';
import { dispatchChatRolesConsoleRpc } from '../../src/instance/console/chat-roles-rpc.js';
import { instanceConsoleCapabilities, isInstanceConsoleRpcType } from '../../src/instance/console/rpc-capabilities.js';
import { sqliteAvailable } from './sqlite-availability.js';

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

function setup(options: { now?: () => number } = {}) {
  const store = new ChatRoleStore(options.now ? { now: options.now } : {});
  const roles: InstanceChatRoleService = new ChatRoleService({ store });
  const audits: Record<string, any>[] = [];
  const people = new ChatPeople({ store, audit: () => entry => { audits.push(entry); }, ...(options.now ? { now: options.now } : {}) });
  let next = 0;
  const codes = new ChatIdentityBindCodes({ people, ...(options.now ? { now: options.now } : {}), code: () => ['BIND2222', 'BIND3333', 'BIND4444', 'BIND5555'][next++]! });
  return { store, roles, people, codes, audits };
}

const qq = (userId: string) => ({ adapter: 'qq', userId });
const tg = (userId: string) => ({ adapter: 'tg', userId });

describe('people and identities (ADR 0060 §2)', () => {
  it('a grant creates the identity\'s own person; ids are cp_ + 128-bit base32', async () => {
    const { store, roles } = setup();
    expect(newChatPrincipalId()).toMatch(/^cp_[a-z2-7]{26}$/u);
    await store.grant({ level: 'global', key: '', ...qq('alice'), role: 'owner' });
    const person = roles.principalOf(qq('alice'));
    expect(isChatPrincipalId(person.id)).toBe(true);
    expect(person.identities).toEqual([qq('alice')]);
    expect(store.list()).toMatchObject([{ principalId: person.id, adapter: 'qq', userId: 'alice', role: 'owner' }]);
    // A speaker without grants stays an implicit person: no row is created for them.
    expect(roles.principalOf(qq('bob')).id).toBe('implicit:qq:bob');
    expect(store.principals.principals()).toHaveLength(1);
  });

  it('merge: global grants reach every identity, adapter grants stay on their adapter (Q10), the higher role wins', async () => {
    const { store, roles, people, audits } = setup();
    await store.grant({ level: 'global', key: '', ...qq('alice'), role: 'trusted' });
    await store.grant({ level: 'adapter', key: 'qq', ...qq('alice'), role: 'admin' });
    await store.grant({ level: 'global', key: '', ...tg('alice-tg'), role: 'admin' });
    const changes: unknown[] = [];
    store.subscribe(change => { changes.push(change); });
    const result = await people.merge({ into: qq('alice'), from: tg('alice-tg'), actor: 'user:op' });
    expect(result.status).toBe('saved');
    const person = roles.principalOf(tg('alice-tg'));
    expect(person.id).toBe(result.principalId);
    expect(person.identities).toEqual(expect.arrayContaining([qq('alice'), tg('alice-tg')]));
    // Both held global: the higher (admin) stayed, one row left.
    expect(store.list().filter(entry => entry.level === 'global')).toMatchObject([{ role: 'admin' }]);
    expect(roles.roleAt(qq('alice'), 'qq/bot/group:1')).toBe('admin');
    // The qq adapter grant does not make the Telegram identity a Telegram admin.
    expect(roles.roleAt(tg('alice-tg'), 'tg')).toBe('admin');
    await store.revoke({ level: 'global', key: '', ...tg('alice-tg') });
    expect(roles.roleAt(tg('alice-tg'), 'tg')).toBeUndefined();
    expect(roles.roleAt(qq('alice'), 'qq')).toBe('admin');
    expect(changes).toContainEqual(expect.objectContaining({ kind: 'merge', principalId: result.principalId }));
    expect(audits).toContainEqual(expect.objectContaining({ action: 'chat-principals.merge', actor: 'user:op', outcome: 'ok' }));
  });

  it('split gives the identity its own person; adapter grants nobody else can use go with it', async () => {
    const { store, roles, people } = setup();
    await store.grant({ level: 'global', key: '', ...qq('alice'), role: 'trusted' });
    await store.grant({ level: 'adapter', key: 'qq', ...qq('alice'), role: 'admin' });
    await people.merge({ into: tg('alice-tg'), from: qq('alice'), actor: 'user:op' });
    const before = roles.principalOf(qq('alice')).id;
    const split = await people.split({ identity: qq('alice'), actor: 'user:op' });
    expect(split.status).toBe('saved');
    expect(roles.principalOf(qq('alice')).id).toBe(split.principalId);
    expect(roles.principalOf(tg('alice-tg')).id).toBe(before);
    // Global stays with the old person (its dual identity moved to tg); the qq admin went with qq.
    expect(store.grantsOf(before)).toMatchObject([{ level: 'global', role: 'trusted', adapter: 'tg', userId: 'alice-tg' }]);
    expect(roles.roleAt(qq('alice'), 'qq')).toBe('admin');
    expect(roles.roleAt(qq('alice'), '')).toBeUndefined();
    // Splitting a single-identity person changes nothing.
    expect((await people.split({ identity: qq('alice'), actor: 'user:op' })).status).toBe('unchanged');
  });

  it('a platform identity belongs to at most one person; links are one-to-one', async () => {
    const { store, roles, people } = setup();
    await store.grant({ level: 'global', key: '', ...qq('a'), role: 'trusted' });
    await store.grant({ level: 'global', key: '', ...qq('b'), role: 'trusted' });
    const a = roles.principalOf(qq('a')).id;
    const b = roles.principalOf(qq('b')).id;
    await people.linkConsole({ principal: { principalId: a }, consoleUserId: 'u1', via: 'manual', actor: 'user:op' });
    await expect(people.linkConsole({ principal: { principalId: b }, consoleUserId: 'u1', via: 'manual', actor: 'user:op' })).rejects.toMatchObject({ code: 'conflict' });
    await people.linkConsole({ principal: { principalId: b }, consoleUserId: 'u2', via: 'manual', actor: 'user:op' });
    // Both linked to different Console users: no merge.
    await expect(people.merge({ into: { principalId: a }, from: { principalId: b }, actor: 'user:op' })).rejects.toMatchObject({ code: 'conflict' });
    expect(store.principals.identities().filter(identity => identity.userId === 'a')).toHaveLength(1);
  });

  it('records sightings (throttled) and clears display names after 90 days (Q11)', async () => {
    let now = 1_000_000;
    const { store, people } = setup({ now: () => now });
    people.observe({ identity: qq('x'), scopeKey: 'qq/bot/group:1', displayName: 'Xiao' });
    people.observe({ identity: qq('x'), scopeKey: 'qq/bot/group:1', displayName: 'Xiao' });
    await store.exclusive(async () => undefined);
    expect(store.principals.identity(qq('x'))).toMatchObject({ lastSeenAt: 1_000_000, lastDisplayName: 'Xiao', lastScopeKey: 'qq/bot/group:1' });
    expect(store.principals.identity(qq('x'))?.principalId).toBeUndefined();
    now += CHAT_IDENTITY_SIGHTING_THROTTLE_MS - 1;
    people.observe({ identity: qq('x'), scopeKey: 'qq/bot/group:1', displayName: 'Xiao' });
    await store.exclusive(async () => undefined);
    expect(store.principals.identity(qq('x'))?.lastSeenAt).toBe(1_000_000);
    await store.grant({ level: 'global', key: '', ...qq('y'), role: 'trusted' });
    people.observe({ identity: qq('y'), scopeKey: 'qq/bot/group:1', displayName: 'Yan' });
    await store.exclusive(async () => undefined);
    now += CHAT_IDENTITY_RETENTION_MS + 1;
    await people.expireSightings();
    expect(store.principals.identity(qq('x'))).toBeUndefined();
    expect(store.principals.identity(qq('y'))).toMatchObject({ principalId: expect.any(String) });
    expect(store.principals.identity(qq('y'))?.lastDisplayName).toBeUndefined();
  });
});

describe('bind codes (ADR 0060 §2.4 / §5.2)', () => {
  const actor = (kind: 'private' | 'group', identity = qq('alice')) => ({
    identity, conversationKey: `${identity.adapter}/bot/${kind}:1`, endpointKey: `${identity.adapter}/bot`, kind, context: { conversationKey: `${identity.adapter}/bot/${kind}:1` },
  }) as never;

  it('binds in a private chat, single use, audited with the code hash only', async () => {
    const { roles, store, codes, audits } = setup();
    const { code } = codes.create({ consoleUserId: 'u1', consoleDisplayName: 'Alice C', canManageGlobal: false });
    expect(code).toBe('BIND2222');
    expect(await executeIdentityBind({ code: 'bind-2222', actor: actor('private'), adapterKind: 'platform', locale: 'zh-CN' }, codes)).toContain('已绑定');
    const person = roles.principalOf(qq('alice')).id;
    expect(store.principals.linkOf(person)).toMatchObject({ consoleUserId: 'u1', consoleDisplayName: 'Alice C', linkedVia: 'code' });
    expect(store.principals.identity(qq('alice'))?.linkMethod).toBe('code');
    expect(await executeIdentityBind({ code: 'BIND2222', actor: actor('private', qq('mallory')), adapterKind: 'platform', locale: 'zh-CN' }, codes)).toContain('不正确');
    expect(audits).toContainEqual(expect.objectContaining({ action: 'chat-identities.bind', outcome: 'ok', detail: expect.objectContaining({ linkMethod: 'code' }) }));
    expect(JSON.stringify(audits)).not.toContain('BIND2222');
  });

  it('a correct code sent in a group is revoked; simulated adapters never bind', async () => {
    const { roles, codes } = setup();
    codes.create({ consoleUserId: 'u1', canManageGlobal: false });
    expect(await executeIdentityBind({ code: 'BIND2222', actor: actor('group'), adapterKind: 'platform', locale: 'zh-CN' }, codes)).toContain('只接受私聊');
    expect(codes.pending('u1')).toBeUndefined();
    expect(await executeIdentityBind({ code: 'BIND2222', actor: actor('private'), adapterKind: 'platform', locale: 'zh-CN' }, codes)).toContain('不正确');
    codes.create({ consoleUserId: 'u1', canManageGlobal: false });
    expect(await executeIdentityBind({ code: 'BIND3333', actor: actor('private'), adapterKind: 'simulated', locale: 'zh-CN' }, codes)).toContain('不接受绑定');
    expect(roles.principalOf(qq('alice')).id).toBe('implicit:qq:alice');
  });

  it('an identity owned by another linked person cannot be bound to a second person', async () => {
    const { roles, people, store, codes } = setup();
    await store.grant({ level: 'global', key: '', ...qq('alice'), role: 'trusted' });
    await people.linkConsole({ principal: qq('alice'), consoleUserId: 'owner-user', via: 'manual', actor: 'user:op' });
    codes.create({ consoleUserId: 'intruder', canManageGlobal: true });
    expect(await executeIdentityBind({ code: 'BIND2222', actor: actor('private'), adapterKind: 'platform', locale: 'zh-CN' }, codes)).toContain('已属于另一个人');
    expect(store.principals.linkOfConsoleUser('intruder')).toBeUndefined();
    expect(store.principals.linkOf(roles.principalOf(qq('alice')).id)?.consoleUserId).toBe('owner-user');
  });

  it('binding that would carry roles to another identity needs a code from a global iam.manage holder', async () => {
    const { roles, store, codes } = setup();
    // u1's person holds a global owner grant through tg; a viewer must not extend it to new identities.
    await store.grant({ level: 'global', key: '', ...tg('boss'), role: 'owner' });
    await new ChatPeople({ store }).linkConsole({ principal: tg('boss'), consoleUserId: 'u1', via: 'manual', actor: 'user:op' });
    codes.create({ consoleUserId: 'u1', canManageGlobal: false });
    expect(await executeIdentityBind({ code: 'BIND2222', actor: actor('private', qq('phished')), adapterKind: 'platform', locale: 'zh-CN' }, codes)).toContain('全局 iam.manage');
    expect(roles.hasRole(qq('phished'), '', 'owner')).toBe(false);
    codes.create({ consoleUserId: 'u1', canManageGlobal: true });
    expect(await executeIdentityBind({ code: 'BIND3333', actor: actor('private', qq('boss-qq')), adapterKind: 'platform', locale: 'zh-CN' }, codes)).toContain('已绑定');
    expect(roles.hasRole(qq('boss-qq'), '', 'owner')).toBe(true);
  });

  it('locks an identity out after repeated wrong codes', async () => {
    const { codes } = setup();
    codes.create({ consoleUserId: 'u1', canManageGlobal: false });
    for (let index = 0; index < CHAT_BIND_MAX_FAILURES; index += 1) {
      await codes.attempt({ code: 'WRONG222', identity: qq('guess'), kind: 'private', adapterKind: 'platform' });
    }
    expect(await codes.attempt({ code: 'BIND2222', identity: qq('guess'), kind: 'private', adapterKind: 'platform' })).toBe('locked');
  });
});

describe('Console user lifecycle and grantor names (ADR 0060 §2.4, Q12)', () => {
  it('removing a Console user removes its link but keeps the roles', async () => {
    const { roles, store, people, audits } = setup();
    await store.grant({ level: 'global', key: '', ...qq('alice'), role: 'owner', grantedBy: 'user:u1' });
    await people.linkConsole({ principal: qq('alice'), consoleUserId: 'u1', consoleDisplayName: 'Console Alice', via: 'manual', actor: 'user:op' });
    expect(chatGrantorName(people, 'user:u1')).toBe('Console Alice');
    await people.rename({ principalId: roles.principalOf(qq('alice')).id, displayName: '爱丽丝', actor: 'user:op' });
    expect(chatGrantorName(people, 'user:u1')).toBe('爱丽丝');
    expect(chatGrantorName(people, 'user:unknown')).toBeUndefined();
    const listed = await dispatchChatRolesConsoleRpc({ type: 'chat-roles.list', data: { level: 'global' } },
      { roles, authorize: () => true, grantorName: grantedBy => chatGrantorName(people, grantedBy) });
    expect((listed!.body.data as any).roles[0]).toMatchObject({ grantedBy: 'user:u1', grantedByName: '爱丽丝', principalId: roles.principalOf(qq('alice')).id });
    expect(await people.consoleUserRemoved('u1', 'deleted')).toBe('saved');
    expect(store.principals.linkOfConsoleUser('u1')).toBeUndefined();
    expect(roles.hasRole(qq('alice'), '', 'owner')).toBe(true);
    expect(audits).toContainEqual(expect.objectContaining({ action: 'chat-principals.unlink-console', actor: 'gateway', detail: expect.objectContaining({ reason: 'deleted' }) }));
  });

  it.skipIf(!sqliteAvailable)('the gateway\'s principal-revoked (deleted / disabled) removes the link; other reasons do not', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-chat-principals-'));
    directories.push(root);
    const { createFeatureHost } = await import('../../src/instance/feature-host-installer.js');
    const database = createDatabaseHost({ dialect: 'sqlite', filename: join(root, 'bot.db') });
    const listeners = new Set<(message: any) => void>();
    const host = createFeatureHost({ database, hostConfig: {}, snapshots: () => ({ acquire: () => { throw new Error('unused'); } }) as never,
      gatewayMessages: { onMessage: listener => { listeners.add(listener); return () => listeners.delete(listener); } } });
    await database.start();
    await host.roles.store.load();
    await host.roles.store.grant({ level: 'global', key: '', ...qq('alice'), role: 'owner' });
    await host.people.linkConsole({ principal: qq('alice'), consoleUserId: 'u1', via: 'manual', actor: 'test' });
    const send = async (reason: string) => {
      for (const listener of listeners) listener({ type: 'principal-revoked', payload: { principalId: 'u1', reason } });
      await host.roles.store.exclusive(async () => undefined);
    };
    await send('password');
    await send('bindings');
    expect(host.roles.store.principals.linkOfConsoleUser('u1')).toBeDefined();
    await send('disabled');
    expect(host.roles.store.principals.linkOfConsoleUser('u1')).toBeUndefined();
    expect(host.roles.hasRole(qq('alice'), '', 'owner')).toBe(true);
    await database.stop();
  });

  it('touchConsoleUser refreshes the cached display name', async () => {
    const { store, people } = setup();
    await store.grant({ level: 'global', key: '', ...qq('alice'), role: 'trusted' });
    await people.linkConsole({ principal: qq('alice'), consoleUserId: 'u1', consoleDisplayName: 'Old', via: 'manual', actor: 'user:op' });
    people.touchConsoleUser('u1', 'New');
    await store.exclusive(async () => undefined);
    expect(store.principals.linkOfConsoleUser('u1')?.consoleDisplayName).toBe('New');
  });
});

describe('chat-principals.* / chat-identities.* Console RPC (ADR 0060 §7)', () => {
  const rpc = (type: string, data: Record<string, unknown>, context: ChatPrincipalsRpcContext) =>
    dispatchChatPrincipalsConsoleRpc({ type, data }, context).then(reply => reply!);
  /** iam.manage on adapter `qq` only. */
  const scoped = (request: { level: string; key?: string }) => request.level !== 'global' && (request.key === 'qq' || request.key?.startsWith('qq/') === true);
  const global = () => true;

  it('merging a person with a global grant needs global iam.manage', async () => {
    const { roles, store, people } = setup();
    await store.grant({ level: 'global', key: '', ...qq('boss'), role: 'owner' });
    await store.grant({ level: 'adapter', key: 'qq', ...qq('helper'), role: 'trusted' });
    const denied = await rpc(CHAT_PRINCIPALS_RPC.MERGE, { into: qq('helper'), from: qq('boss') }, { people, authorize: scoped, actor: 'user:scoped' });
    expect(denied.status).toBe(403);
    expect(roles.principalOf(qq('helper')).id).not.toBe(roles.principalOf(qq('boss')).id);
    // A scoped manager may not merge identities on adapters they do not manage either.
    await store.grant({ level: 'adapter', key: 'tg', ...tg('t'), role: 'trusted' });
    expect((await rpc(CHAT_PRINCIPALS_RPC.MERGE, { into: qq('helper'), from: tg('t') }, { people, authorize: scoped })).status).toBe(403);
    const ok = await rpc(CHAT_PRINCIPALS_RPC.MERGE, { into: qq('helper'), from: qq('boss') }, { people, authorize: global, actor: 'user:root' });
    expect(ok.status).toBe(200);
    expect(roles.hasRole(qq('helper'), '', 'owner')).toBe(true);
  });

  it('a scoped manager sees only identities on its adapters and no Console links', async () => {
    const { store, people } = setup();
    await store.grant({ level: 'global', key: '', ...qq('alice'), role: 'trusted' });
    await people.merge({ into: qq('alice'), from: tg('alice-tg'), actor: 'user:root' });
    await people.linkConsole({ principal: qq('alice'), consoleUserId: 'u1', via: 'manual', actor: 'user:root' });
    await store.grant({ level: 'adapter', key: 'tg', ...tg('other'), role: 'trusted' });
    expect((await rpc(CHAT_PRINCIPALS_RPC.LIST, {}, { people, authorize: scoped })).status).toBe(403);
    const listed = await rpc(CHAT_PRINCIPALS_RPC.LIST, { level: 'adapter', key: 'qq' }, { people, authorize: scoped });
    const principals = (listed.body.data as any).principals;
    expect(principals).toHaveLength(1);
    expect(principals[0]).toMatchObject({ identities: [{ adapter: 'qq', userId: 'alice' }], hiddenIdentities: 1, unverified: true });
    expect(principals[0].consoleLink).toBeUndefined();
    expect(principals[0].roles[0]).toMatchObject({ redacted: true });
    const all = await rpc(CHAT_PRINCIPALS_RPC.LIST, {}, { people, authorize: global });
    expect((all.body.data as any).principals.find((person: any) => person.consoleLink)).toMatchObject({ consoleLink: { consoleUserId: 'u1' } });
  });

  it('link-console, export and import need global iam.manage; import never lowers, removes or reassigns', async () => {
    const source = setup();
    await source.store.grant({ level: 'global', key: '', ...qq('alice'), role: 'admin' });
    await source.store.grant({ level: 'adapter', key: 'tg', ...tg('bob'), role: 'trusted' });
    await source.people.merge({ into: qq('alice'), from: tg('alice-tg'), actor: 'user:root' });
    await source.people.linkConsole({ principal: qq('alice'), consoleUserId: 'u1', via: 'manual', actor: 'user:root' });
    expect((await rpc(CHAT_PRINCIPALS_RPC.EXPORT, { level: 'adapter', key: 'qq' }, { people: source.people, authorize: scoped })).status).toBe(403);
    expect((await rpc(CHAT_PRINCIPALS_RPC.LINK_CONSOLE, { level: 'adapter', key: 'qq', principalId: source.roles.principalOf(qq('alice')).id, consoleUserId: 'u9' },
      { people: source.people, authorize: scoped })).status).toBe(403);
    const exported = (await rpc(CHAT_PRINCIPALS_RPC.EXPORT, {}, { people: source.people, authorize: global })).body.data as any;
    expect(exported).toMatchObject({ format: 'zhin.chat-roles', version: 1 });

    const target = setup();
    // Already stored: alice is owner (higher), alice-tg belongs to someone else.
    await target.store.grant({ level: 'global', key: '', ...qq('alice'), role: 'owner' });
    await target.store.grant({ level: 'global', key: '', ...tg('alice-tg'), role: 'trusted' });
    expect((await rpc(CHAT_PRINCIPALS_RPC.IMPORT, { level: 'adapter', key: 'qq', data: exported }, { people: target.people, authorize: scoped })).status).toBe(403);
    const imported = await rpc(CHAT_PRINCIPALS_RPC.IMPORT, { data: exported }, { people: target.people, authorize: global, actor: 'user:root' });
    expect(imported.status).toBe(200);
    expect((imported.body.data as any).skipped.some((line: string) => line.includes('alice-tg'))).toBe(true);
    expect(target.roles.roleAt(qq('alice'), '')).toBe('owner');
    expect(target.roles.principalOf(tg('alice-tg')).id).not.toBe(target.roles.principalOf(qq('alice')).id);
    expect(target.roles.roleAt(tg('alice-tg'), '')).toBe('trusted');
    expect(target.roles.roleAt(tg('bob'), 'tg')).toBe('trusted');
    expect(target.store.principals.linkOfConsoleUser('u1')?.principalId).toBe(target.roles.principalOf(qq('alice')).id);
    // A grant below global for an identity on another adapter is malformed, never stored.
    const forged = { ...exported, roles: [{ level: 'adapter', key: 'qq', adapter: 'tg', userId: 'x', role: 'owner' }] };
    await rpc(CHAT_PRINCIPALS_RPC.IMPORT, { data: forged }, { people: target.people, authorize: global });
    expect(target.roles.roleAt(tg('x'), 'qq')).toBeUndefined();
    expect(target.audits).toContainEqual(expect.objectContaining({ action: 'chat-roles.import' }));
  });

  it('bind codes and `me` only for a signed-in Console user, about their own link', async () => {
    const { store, people, codes } = setup();
    expect((await rpc(CHAT_PRINCIPALS_RPC.BIND_CODE_CREATE, {}, { people, codes, authorize: global })).status).toBe(403);
    const created = await rpc(CHAT_PRINCIPALS_RPC.BIND_CODE_CREATE, {}, { people, codes, authorize: () => false, consoleUser: { userId: 'viewer', displayName: 'V' } });
    expect(created.body.data).toMatchObject({ code: 'BIND2222', expiresAt: expect.any(Number) });
    const me = await rpc(CHAT_PRINCIPALS_RPC.ME, {}, { people, codes, authorize: () => false, consoleUser: { userId: 'viewer' } });
    expect(me.body.data).toEqual({ pendingCode: { expiresAt: (created.body.data as any).expiresAt } });
    await codes.attempt({ code: 'BIND2222', identity: qq('v'), kind: 'private', adapterKind: 'platform' });
    const after = await rpc(CHAT_PRINCIPALS_RPC.ME, {}, { people, codes, authorize: () => true, consoleUser: { userId: 'viewer' } });
    expect((after.body.data as any).principal.identities).toMatchObject([{ adapter: 'qq', userId: 'v', linkMethod: 'code' }]);
    expect((after.body.data as any).suggestGlobalOwner).toBe(true);
    expect(store.principals.linkOfConsoleUser('viewer')).toBeDefined();
  });

  it('simulated.ensure gives only the caller an identity on simulation adapters, never on a platform (ADR 0060 §5.4)', async () => {
    const { store, roles, people, audits } = setup();
    const simulated = () => ['sandbox'];
    // No signed-in user (bootstrap / standalone): refused.
    expect((await rpc(CHAT_PRINCIPALS_RPC.SIMULATED_ENSURE, {}, { people, authorize: global, simulatedAdapters: simulated })).status).toBe(403);
    // A real platform adapter is never touched (that needs a bind code from the identity's holder).
    expect((await rpc(CHAT_PRINCIPALS_RPC.SIMULATED_ENSURE, { adapter: 'qq' }, { people, authorize: () => false, consoleUser: { userId: 'u1' }, simulatedAdapters: simulated })).status).toBe(400);
    expect((await rpc(CHAT_PRINCIPALS_RPC.SIMULATED_ENSURE, {}, { people, authorize: () => false, consoleUser: { userId: 'u1' }, simulatedAdapters: () => [] })).status).toBe(404);
    // Unlinked: a new person, linked (`console`), with a sandbox identity; no role comes with it.
    const first = await rpc(CHAT_PRINCIPALS_RPC.SIMULATED_ENSURE, {}, { people, authorize: () => false, consoleUser: { userId: 'u1', displayName: 'Una' }, simulatedAdapters: simulated });
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({ status: 'saved', identities: [{ adapter: 'sandbox', userId: 'console-u1', linkMethod: 'console' }] });
    expect(store.principals.linkOfConsoleUser('u1')).toMatchObject({ linkedVia: 'console' });
    expect(roles.roleAt({ adapter: 'sandbox', userId: 'console-u1' }, '')).toBeUndefined();
    expect((await rpc(CHAT_PRINCIPALS_RPC.SIMULATED_ENSURE, {}, { people, authorize: () => false, consoleUser: { userId: 'u1' }, simulatedAdapters: simulated })).body.data)
      .toMatchObject({ status: 'unchanged' });
    // Linked to a global owner: the sandbox identity joins that person and so speaks as the owner.
    await store.grant({ level: 'global', key: '', ...qq('boss'), role: 'owner' });
    await people.linkConsole({ principal: qq('boss'), consoleUserId: 'u-boss', via: 'manual', actor: 'user:root' });
    await rpc(CHAT_PRINCIPALS_RPC.SIMULATED_ENSURE, { adapter: 'sandbox' }, { people, authorize: () => false, consoleUser: { userId: 'u-boss' }, simulatedAdapters: simulated });
    expect(roles.hasRole({ adapter: 'sandbox', userId: 'console-u-boss' }, 'sandbox/dev/private:x', 'owner')).toBe(true);
    expect(audits).toContainEqual(expect.objectContaining({ action: 'chat-identities.bind', actor: 'console:user:u-boss', detail: expect.objectContaining({ linkMethod: 'console' }) }));
    // The reader resolves the Console speaker from the link only.
    const reader = createChatRoleReader({ roles: () => roles, conversationKey: c => `sandbox/dev/${c.kind}:${c.id}`,
      consolePrincipal: user => store.principals.linkOfConsoleUser(user)?.principalId });
    const room = { endpoint: { id: 'x', adapter: 'sandbox' }, kind: 'private', id: 'r' } as never;
    expect(reader.consoleSpeaker!(room, 'u-boss')).toEqual({ adapter: 'sandbox', userId: 'console-u-boss' });
    expect(reader.consoleSpeaker!(room, 'u-nobody')).toBeUndefined();
    // Typing the owner's sandbox id as a simulated sender never resolves the role.
    expect(reader.factsOf(room, '~sim:console-u-boss')).toBeUndefined();
  });

  it('chat-identities.recent lists recent speakers at the scope', async () => {
    const { store, people } = setup();
    people.observe({ identity: qq('x'), scopeKey: 'qq/bot/group:1', displayName: 'Xiao' });
    people.observe({ identity: tg('y'), scopeKey: 'tg/bot/group:1', displayName: 'Yan' });
    await store.exclusive(async () => undefined);
    const recent = await rpc(CHAT_PRINCIPALS_RPC.IDENTITIES_RECENT, { level: 'endpoint', key: 'qq/bot' }, { people, authorize: scoped });
    expect((recent.body.data as any).identities).toMatchObject([{ adapter: 'qq', userId: 'x', lastDisplayName: 'Xiao', principalId: 'implicit:qq:x' }]);
    expect((await rpc(CHAT_PRINCIPALS_RPC.IDENTITIES_RECENT, { level: 'endpoint', key: 'tg/bot' }, { people, authorize: scoped })).status).toBe(403);
  });

  it('is registered in the permission map; every built-in role may bind its own identity (Q4)', () => {
    for (const role of Object.values(CONSOLE_BUILTIN_ROLES)) expect(role.permissions).toContain('self.chat-identity');
    const viewer: ConsolePrincipal = { kind: 'user', userId: 'v', username: 'v', displayName: 'v', credentialId: 'c', roles: ['viewer'],
      grants: [{ scope: { kind: 'global' }, permissions: [...CONSOLE_BUILTIN_ROLES.viewer.permissions] }] } as never;
    expect(authorizeConsoleRpc(viewer, { type: CHAT_PRINCIPALS_RPC.BIND_CODE_CREATE }).allowed).toBe(true);
    expect(authorizeConsoleRpc(viewer, { type: CHAT_PRINCIPALS_RPC.ME }).allowed).toBe(true);
    expect(authorizeConsoleRpc(viewer, { type: CHAT_PRINCIPALS_RPC.SIMULATED_ENSURE }).allowed).toBe(true);
    expect(authorizeConsoleRpc(viewer, { type: CHAT_PRINCIPALS_RPC.MERGE, data: {} }).allowed).toBe(false);
    const scopedManager: ConsolePrincipal = { kind: 'user', userId: 's', username: 's', displayName: 's', credentialId: 'c', roles: [],
      grants: [{ scope: { kind: 'adapter', key: 'qq' }, permissions: ['iam.manage'] }] } as never;
    expect(authorizeConsoleRpc(scopedManager, { type: CHAT_PRINCIPALS_RPC.LIST, data: { level: 'adapter', key: 'qq' } }).allowed).toBe(true);
    expect(authorizeConsoleRpc(scopedManager, { type: CHAT_PRINCIPALS_RPC.LIST, data: {} }).allowed).toBe(false);
    for (const type of Object.values(CHAT_PRINCIPALS_RPC)) expect(authorizeConsoleRpc(viewer, { type }).code).not.toBe('unknown_rpc');
  });

  it('is an RPC type the instance answers, listed in its Console capabilities', () => {
    const rpc = new Set(instanceConsoleCapabilities().rpc);
    for (const type of [...Object.values(CHAT_PRINCIPALS_RPC), ...Object.values(CHAT_ROLES_RPC)]) {
      expect(isInstanceConsoleRpcType(type)).toBe(true);
      expect(rpc.has(type)).toBe(true);
    }
  });
});

describe('chat_roles migration to the person model (ADR 0060 §2.3 / §4.5)', () => {
  const legacyRowId = (level: string, key: string, adapter: string, userId: string) =>
    createHash('sha256').update(JSON.stringify([level, key, adapter, userId])).digest('hex');

  it.skipIf(!sqliteAvailable)('backfills principal_id idempotently, keeps the rollback columns, backs up first, never raises', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-chat-principals-'));
    directories.push(root);
    const filename = join(root, 'bot.db');
    // The pre-P2 table (no principal_id), as an older release left it.
    const legacy = createDatabaseHost({ dialect: 'sqlite', filename });
    legacy.define('chat_roles', {
      id: { type: 'text', length: 64, primary: true, nullable: false }, level: { type: 'text', nullable: false },
      scope_key: { type: 'text', nullable: false }, adapter: { type: 'text', nullable: false }, user_id: { type: 'text', nullable: false },
      role: { type: 'text', nullable: false }, granted_by: { type: 'text', nullable: true }, granted_at: { type: 'bigint', nullable: false },
    });
    await legacy.start();
    const rows = [['global', '', 'qq', 'boss', 'owner'], ['endpoint', 'qq/bot', 'qq', 'acct', 'admin'], ['adapter', 'tg', 'tg', 'boss-tg', 'trusted']] as const;
    for (const [level, key, adapter, userId, role] of rows) {
      await legacy.models.get('chat_roles')!.insert({ id: legacyRowId(level, key, adapter, userId), level, scope_key: key, adapter, user_id: userId, role, granted_by: null, granted_at: 1 });
    }
    await legacy.stop();

    const open = async () => {
      const host = createDatabaseHost({ dialect: 'sqlite', filename });
      defineChatRoleTable(host);
      defineChatPrincipalTables(host);
      await host.start();
      return host;
    };
    const migrated: unknown[] = [];
    const first = await open();
    const store = new ChatRoleStore({ database: first, projectRoot: root, onMigrated: result => { migrated.push(result); } });
    await store.load();
    const roles = new ChatRoleService({ store });
    expect(migrated).toHaveLength(1);
    expect(migrated[0]).toMatchObject({ migrated: 3, backup: expect.stringContaining('chat-roles-') });
    const backups = await readdir(join(root, CHAT_ROLE_BACKUP_DIRECTORY));
    expect(backups).toHaveLength(1);
    const backup = JSON.parse(await readFile(join(root, CHAT_ROLE_BACKUP_DIRECTORY, backups[0]!), 'utf8'));
    expect(backup.roles).toHaveLength(3);
    expect(backup.roles.every((row: any) => row.principalId === undefined)).toBe(true);
    // Same roles at the same scopes: the migration grants nothing new.
    expect(roles.roleAt(qq('boss'), '')).toBe('owner');
    expect(roles.roleAt(qq('acct'), 'qq/bot')).toBe('admin');
    expect(roles.roleAt(qq('acct'), '')).toBeUndefined();
    expect(roles.roleAt(tg('boss-tg'), 'tg')).toBe('trusted');
    const stored = await first.models.get('chat_roles')!.select('id', 'adapter', 'user_id', 'level', 'scope_key', 'principal_id');
    // Rollback: the old columns and row ids are intact, so an older release reads and revokes them.
    for (const row of stored) {
      expect(row.id).toBe(legacyRowId(String(row.level), String(row.scope_key), String(row.adapter), String(row.user_id)));
      expect(isChatPrincipalId(row.principal_id)).toBe(true);
    }
    const ids = store.list().map(entry => entry.principalId).sort();
    // An older release (after a rollback) inserts a lower grant for an identity now merged into boss.
    await new ChatPeople({ store }).merge({ into: qq('boss'), from: tg('boss-tg'), actor: 'test' });
    await first.models.get('chat_roles')!.insert({ id: legacyRowId('global', '', 'tg', 'boss-tg'), level: 'global', scope_key: '', adapter: 'tg', user_id: 'boss-tg', role: 'trusted', granted_by: null, granted_at: 2 });
    await first.stop();

    const second = await open();
    const reloaded = new ChatRoleStore({ database: second, projectRoot: root, onMigrated: result => { migrated.push(result); } });
    await reloaded.load();
    // Idempotent: the earlier rows keep their person; the duplicate collapses to the higher role.
    expect(reloaded.list().filter(entry => entry.level === 'global')).toMatchObject([{ role: 'owner', adapter: 'qq', userId: 'boss' }]);
    expect(new ChatRoleService({ store: reloaded }).roleAt(tg('boss-tg'), '')).toBe('owner');
    expect(ids).toHaveLength(3);
    await reloaded.load();
    expect(migrated).toHaveLength(2);
    await second.stop();
  });
});
