import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { grantsAllow, type ConsoleGrant, type ConsoleScopeTarget } from '@zhin.js/console-protocol';
import { ChatRoleService, ChatRoleStore, type InstanceChatRoleService } from '../../src/instance/chat-roles.js';
import { ChatPeople } from '../../src/instance/chat-people.js';
import {
  PERSONAL_PRINCIPALS_IMPORT_FILE, PersonalPrincipalImportBook, type PersonalPrincipalSeed,
} from '../../src/instance/chat-personal-principals.js';
import { ATTENTION_PATHS, collectAttention, type AttentionChatRoles } from '../../src/instance/console/attention.js';
import { dispatchChatRoleImportsConsoleRpc } from '../../src/instance/console/chat-role-imports-rpc.js';
import { ChatRoleImportBook } from '../../src/instance/chat-role-migration.js';

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'zhin-personal-principals-'));
  directories.push(root);
  const store = new ChatRoleStore();
  const roles: InstanceChatRoleService = new ChatRoleService({ store });
  const audits: Record<string, any>[] = [];
  const people = new ChatPeople({ store, audit: () => entry => { audits.push(entry); } });
  const logs: string[] = [];
  const logger = { info: (line: string) => logs.push(`info ${line}`), warn: (line: string) => logs.push(`warn ${line}`) };
  const book = new PersonalPrincipalImportBook({ projectRoot: root, now: () => 100 });
  return { root, store, roles, people, audits, logs, logger, book };
}

const seed = (key: string, userId: string, extra: Partial<PersonalPrincipalSeed> = {}): PersonalPrincipalSeed =>
  ({ key, adapterId: 'qq-cap\0bot', subjectId: userId, identity: { adapter: 'qq', userId }, ...extra });

describe('ai.personalPrincipals import (ADR 0060 §4.1, P3)', () => {
  it('creates a person linked to the Console user, joins the identities and grants no role', async () => {
    const { store, roles, people, audits, logs, logger, book, root } = await setup();
    const state = await book.run({ seeds: [seed('user:u1', '10001'), seed('user:u1', '10002', { foreignRoot: true })], people, logger });
    const link = store.principals.linkOfConsoleUser('u1');
    expect(link).toMatchObject({ linkedVia: 'import' });
    expect(store.principals.identitiesOf(link!.principalId).map(identity => identity.userId)).toEqual(['10001', '10002']);
    expect(store.list()).toEqual([]);
    expect(roles.roleAt({ adapter: 'qq', userId: '10001' }, '')).toBeUndefined();
    expect(state.entries.map(entry => entry.status)).toEqual(['imported', 'imported']);
    // A moved project no longer fails the start: it imports by alias + subjectId and warns.
    expect(logs.some(line => line.startsWith('warn') && line.includes('rootId'))).toBe(true);
    expect(audits).toContainEqual(expect.objectContaining({ action: 'chat-roles.import', detail: expect.objectContaining({ source: 'ai.personalPrincipals', linked: true }) }));
    expect(JSON.parse(await readFile(join(root, PERSONAL_PRINCIPALS_IMPORT_FILE), 'utf8'))).toMatchObject({ version: 1 });
  });

  it('afterwards the links are the source: a re-run neither re-links nor overrides an operator change', async () => {
    const { store, people, logs, logger, book } = await setup();
    await book.run({ seeds: [seed('user:u1', '10001')], people, logger });
    await people.unlinkConsole({ consoleUserId: 'u1', actor: 'user:root' });
    await book.run({ seeds: [seed('user:u1', '10001')], people, logger });
    expect(store.principals.linkOfConsoleUser('u1')).toBeUndefined();
    expect(logs.some(line => line.includes('数据库为准'))).toBe(true);
  });

  it('keeps unknown adapters pending, skips identities owned by another person and non-user keys', async () => {
    const { store, people, logger, book } = await setup();
    await store.grant({ level: 'global', key: '', adapter: 'qq', userId: 'taken', role: 'trusted' });
    await people.linkConsole({ principal: { adapter: 'qq', userId: 'taken' }, consoleUserId: 'someone-else', via: 'manual', actor: 'user:root' });
    const state = await book.run({ seeds: [
      seed('user:u1', 'taken'), seed('user:u1', 'free'),
      seed('user:u1', '9', { identity: undefined }),
      seed('token:legacy', '7'),
    ], people, logger });
    const by = (userId: string) => state.entries.find(entry => entry.subjectId === userId)!;
    expect(by('taken')).toMatchObject({ status: 'skipped', reason: 'owned-elsewhere' });
    expect(by('free')).toMatchObject({ status: 'imported' });
    expect(by('9')).toMatchObject({ status: 'pending', reason: 'unknown-adapter' });
    expect(by('7')).toMatchObject({ status: 'skipped', reason: 'not-a-user' });
    expect(store.principals.principalOf({ adapter: 'qq', userId: 'taken' })!.id).not.toBe(store.principals.linkOfConsoleUser('u1')!.principalId);
    // The pending one is retried once its adapter is loaded.
    const retried = await book.run({ seeds: [seed('user:u1', '9')], people, logger });
    expect(retried.entries.find(entry => entry.subjectId === '9')).toMatchObject({ status: 'imported' });
  });

  it('an already linked Console user keeps their person; the identity joins it', async () => {
    const { store, people, logger, book } = await setup();
    await people.linkConsole({ principal: { adapter: 'tg', userId: 'me' }, consoleUserId: 'u1', via: 'code', actor: 'user:u1' });
    const before = store.principals.linkOfConsoleUser('u1')!.principalId;
    await book.run({ seeds: [seed('user:u1', '10001')], people, logger });
    expect(store.principals.principalOf({ adapter: 'qq', userId: '10001' })!.id).toBe(before);
  });

  it('security review: never links onto a person who holds grants without a global iam.manage holder confirming it', async () => {
    const { store, roles, people, logger, book, root } = await setup();
    // (a) The configured identity belongs to the owner: linking u-op to it would hand u-op the owner.
    await store.grant({ level: 'global', key: '', adapter: 'qq', userId: 'owner', role: 'owner' });
    // (b) u1 is linked to a person with a global grant: joining an identity would extend it.
    await store.grant({ level: 'global', key: '', adapter: 'tg', userId: 'me', role: 'owner' });
    await people.linkConsole({ principal: { adapter: 'tg', userId: 'me' }, consoleUserId: 'u1', via: 'code', actor: 'user:u1' });
    const state = await book.run({ seeds: [seed('user:u-op', 'owner'), seed('user:u1', '10001')], people, logger });
    expect(state.entries.map(entry => [entry.subjectId, entry.status, entry.reason])).toEqual([
      ['owner', 'pending', 'needs-confirmation'], ['10001', 'pending', 'needs-confirmation']]);
    expect(store.principals.linkOfConsoleUser('u-op')).toBeUndefined();
    expect(store.principals.principalOf({ adapter: 'qq', userId: '10001' })).toBeUndefined();
    expect(roles.hasRole({ adapter: 'qq', userId: '10001' }, '', 'owner')).toBe(false);
    // Listed for a global manager and resolved like a role candidate.
    const imports = new ChatRoleImportBook({ projectRoot: root, roles: () => roles, adapterKind: () => () => 'platform' });
    const context = { imports, personal: book, people, roles, authorizeGlobal: () => true, actor: 'user:root' };
    const listed = await dispatchChatRoleImportsConsoleRpc({ type: 'chat-roles.imports.list' }, context);
    const pending = (listed!.body.data as any).personalPending;
    expect(pending).toMatchObject([{ consoleUserId: 'u-op', adapter: 'qq', userId: 'owner' }, { consoleUserId: 'u1', adapter: 'qq', userId: '10001' }]);
    expect((await dispatchChatRoleImportsConsoleRpc({ type: 'chat-roles.imports.resolve', data: { decision: 'ignore', id: pending[0].id } }, context))!.body.data)
      .toEqual({ status: 'ignored' });
    expect(store.principals.linkOfConsoleUser('u-op')).toBeUndefined();
    expect((await dispatchChatRoleImportsConsoleRpc({ type: 'chat-roles.imports.resolve', data: { decision: 'import', id: pending[1].id } }, context))!.body.data)
      .toEqual({ status: 'imported', result: 'written' });
    expect(roles.principalOf({ adapter: 'qq', userId: '10001' }).id).toBe(store.principals.linkOfConsoleUser('u1')!.principalId);
    // Scoped managers cannot resolve it.
    expect((await dispatchChatRoleImportsConsoleRpc({ type: 'chat-roles.imports.list' }, { ...context, authorizeGlobal: () => false }))!.status).toBe(403);
  });

  it('security review: after the first import, new or changed entries wait for confirmation', async () => {
    const { store, people, logger, book } = await setup();
    await book.run({ seeds: [seed('user:u1', '10001')], people, logger });
    expect(store.principals.linkOfConsoleUser('u1')).toBeDefined();
    // A later configuration edit adds a new user and changes u1's identity: nothing is linked.
    const state = await book.run({ seeds: [seed('user:u1', '10001'), seed('user:u1', '20002'), seed('user:u2', '30003')], people, logger });
    const by = (userId: string) => state.entries.find(entry => entry.subjectId === userId)!;
    expect(by('20002')).toMatchObject({ status: 'pending', reason: 'needs-confirmation' });
    expect(by('30003')).toMatchObject({ status: 'pending', reason: 'needs-confirmation' });
    expect(store.principals.principalOf({ adapter: 'qq', userId: '20002' })).toBeUndefined();
    expect(store.principals.linkOfConsoleUser('u2')).toBeUndefined();
    // A further start does not import them either.
    await book.run({ seeds: [seed('user:u2', '30003')], people, logger });
    expect(store.principals.linkOfConsoleUser('u2')).toBeUndefined();
  });
});

describe('chat-roles.imported for ai.personalPrincipals (Q2)', () => {
  const globalIam: ConsoleGrant[] = [{ permissions: ['iam.manage', 'status.view'], scope: { kind: 'global' } }] as never;
  const allows = (permission: string, target?: ConsoleScopeTarget) => grantsAllow(globalIam, permission, target);
  const state = (overrides: Partial<AttentionChatRoles> = {}): AttentionChatRoles => ({ hasGlobalOwner: false, claimOpen: false, pending: [],
    personal: { at: 3, entries: [{ consoleUserId: 'u1', adapter: 'qq', userId: '10001' }] }, ...overrides });

  it('offers the viewer whose account was linked to make that person the global owner', async () => {
    const mine = await collectAttention({ chatRoles: async () => state() }, { allows, viewerUserId: 'u1' });
    const item = mine.items.find(entry => entry.kind === 'chat-roles.imported')!;
    expect(item.detail).toContain('ai.personalPrincipals');
    expect(item.detail).toContain('全局 owner');
    expect(item.action.path).toBe(ATTENTION_PATHS.chatIdentityMe);
    // Another operator sees the import but no offer about someone else's person.
    const other = (await collectAttention({ chatRoles: async () => state() }, { allows, viewerUserId: 'u2' })).items.find(entry => entry.kind === 'chat-roles.imported')!;
    expect(other.detail).not.toContain('我的聊天身份');
    expect(other.action.path).toBe(ATTENTION_PATHS.chatRoles);
    // With a global owner there is nothing to offer.
    const owned = (await collectAttention({ chatRoles: async () => state({ hasGlobalOwner: true }) }, { allows, viewerUserId: 'u1' })).items.find(entry => entry.kind === 'chat-roles.imported')!;
    expect(owned.action.path).toBe(ATTENTION_PATHS.chatRoles);
  });

  it('lists waiting ai.personalPrincipals links under chat-roles.import-pending (security review)', async () => {
    const result = await collectAttention({ chatRoles: async () => state({ personal: undefined,
      personalPending: [{ id: 'a'.repeat(24), consoleUserId: 'u-op', adapter: 'qq', userId: 'owner', at: 5 }] }) }, { allows });
    const item = result.items.find(entry => entry.kind === 'chat-roles.import-pending')!;
    expect(item.title).toContain('1');
    expect(item.detail).toContain('Console 用户 u-op ↔ qq:owner');
    expect(item.detail).not.toContain('已从配置文件移除');
  });

  it('acknowledge also marks the personal import as read', async () => {
    const { people, logger, book, root, roles } = await setup();
    await book.run({ seeds: [seed('user:u1', '10001')], people, logger });
    const imports = new ChatRoleImportBook({ projectRoot: root, roles: () => roles, adapterKind: () => () => 'platform' });
    const reply = await dispatchChatRoleImportsConsoleRpc({ type: 'chat-roles.imports.resolve', data: { decision: 'acknowledge' } },
      { imports, personal: book, roles, authorizeGlobal: () => true, actor: 'user:root' });
    expect(reply!.body.data).toEqual({ status: 'acknowledged' });
    expect((await book.read()).acknowledgedAt).toBe(100);
  });
});
