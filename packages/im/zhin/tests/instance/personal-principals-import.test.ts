import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { grantsAllow, type ConsoleGrant, type ConsoleScopeTarget } from '@zhin.js/console-protocol';
import { ChatRoleService, ChatRoleStore, type InstanceChatRoleService } from '../../src/instance/chat-roles.js';
import { ChatPeople } from '../../src/instance/chat-people.js';
import {
  PERSONAL_PRINCIPAL_CORRECTION_WINDOW_MS, PERSONAL_PRINCIPALS_IMPORT_FILE, PersonalPrincipalImportBook, personalPrincipalImportId, personalPrincipalSourceLabel, type PersonalPrincipalSeed,
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

  it('re-review: a project that never had entries records its first import, so a first entry added later waits', async () => {
    const { store, people, logger, book, root } = await setup();
    await book.run({ seeds: [], people, logger });
    expect(JSON.parse(await readFile(join(root, PERSONAL_PRINCIPALS_IMPORT_FILE), 'utf8'))).toMatchObject({ version: 1, entries: [], migratedAt: 100 });
    const state = await book.run({ seeds: [seed('user:u-new', '40004')], people, logger });
    expect(state.entries).toMatchObject([{ subjectId: '40004', status: 'pending', reason: 'needs-confirmation' }]);
    expect(store.principals.linkOfConsoleUser('u-new')).toBeUndefined();
  });

  it('re-review: ignore, import and acknowledge of personal links are audited with the actor', async () => {
    const { people, logger, book, root, roles } = await setup();
    await book.run({ seeds: [], people, logger });
    await book.run({ seeds: [seed('user:u1', '50005'), seed('user:u2', '60006')], people, logger });
    const imports = new ChatRoleImportBook({ projectRoot: root, roles: () => roles, adapterKind: () => () => 'platform' });
    const audit: Record<string, any>[] = [];
    const context = { imports, personal: book, people, roles, authorizeGlobal: () => true, actor: 'user:root', audit: (entry: any) => { audit.push(entry); } };
    const pending = ((await dispatchChatRoleImportsConsoleRpc({ type: 'chat-roles.imports.list' }, context))!.body.data as any).personalPending;
    await dispatchChatRoleImportsConsoleRpc({ type: 'chat-roles.imports.resolve', data: { decision: 'ignore', id: pending[0].id } }, context);
    await dispatchChatRoleImportsConsoleRpc({ type: 'chat-roles.imports.resolve', data: { decision: 'import', id: pending[1].id } }, context);
    await dispatchChatRoleImportsConsoleRpc({ type: 'chat-roles.imports.resolve', data: { decision: 'acknowledge' } }, context);
    expect(audit.map(entry => [entry.actor, entry.action, entry.detail?.decision])).toEqual([
      ['user:root', 'chat-roles.import', 'ignore'],
      ['user:root', 'chat-roles.import', 'import'],
      ['user:root', 'chat-roles.import', 'acknowledge'],
    ]);
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

describe('ai.personalPrincipals: a key corrected after the first import (#1250 personal-principals-invalid-key-consumes-migration)', () => {
  const at = (adapterId: string, key: string, userId: string, extra: Partial<PersonalPrincipalSeed> = {}): PersonalPrincipalSeed =>
    ({ key, adapterId, subjectId: userId, identity: { adapter: 'qq', userId }, ...extra });

  it('imports the corrected entries without confirmation, once, audited and shown as unread', async () => {
    const { store, people, logs, logger, book, root } = await setup();
    const audit: Record<string, any>[] = [];
    // First start: the legacy key `workroom-admin` is skipped; the one-time import still runs.
    const first = await book.run({ seeds: [seed('workroom-admin', '10001'), seed('workroom-admin', '10002')], people, logger });
    expect(first.entries.map(entry => [entry.status, entry.reason])).toEqual([['skipped', 'not-a-user'], ['skipped', 'not-a-user']]);
    expect(logs.find(line => line.includes('workroom-admin'))).toContain('首次导入后 30 天内改正，下次启动按首次导入处理');
    // The instance log (readable with status.view) names no Console user; it points to the local CLI.
    expect(logs.find(line => line.includes('workroom-admin'))).toContain('运行 zhin console user list 查看可用的 user id');
    expect(JSON.parse(await readFile(join(root, PERSONAL_PRINCIPALS_IMPORT_FILE), 'utf8'))).toMatchObject({ migratedAt: 100 });
    // The key is corrected: the same identities are imported like the first import.
    const fixed = await book.run({ seeds: [seed('user:u1', '10001'), seed('user:u1', '10002')], people, logger, audit: entry => { audit.push(entry); } });
    const link = store.principals.linkOfConsoleUser('u1');
    expect(link).toBeDefined();
    expect(store.principals.identitiesOf(link!.principalId).map(identity => identity.userId)).toEqual(['10001', '10002']);
    expect(fixed.entries.filter(entry => entry.consoleUserId === 'u1').map(entry => entry.status)).toEqual(['imported', 'imported']);
    expect(fixed.entries.filter(entry => entry.reason === 'not-a-user').every(entry => entry.correctedBy)).toBe(true);
    expect(fixed.acknowledgedAt).toBeUndefined();
    expect(audit.map(entry => entry.detail?.decision)).toEqual(['corrected-key', 'corrected-key']);
    expect(audit[0]!.detail).toMatchObject({ previousKey: 'workroom-admin', consoleUserId: 'u1' });
    expect(logs.some(line => line.includes('因键无效而跳过、现已改正'))).toBe(true);
    // A skipped entry is corrected once: moving the same identity to another key later waits.
    await people.unlinkConsole({ consoleUserId: 'u1', actor: 'user:root' });
    const again = await book.run({ seeds: [seed('user:u2', '10001')], people, logger });
    expect(again.entries.find(entry => entry.consoleUserId === 'u2')).toMatchObject({ status: 'pending', reason: 'needs-confirmation' });
    expect(store.principals.linkOfConsoleUser('u2')).toBeUndefined();
  });

  it('only covers the identities the first import named, and never links onto a person who holds grants', async () => {
    const { store, people, logger, book } = await setup();
    await book.run({ seeds: [seed('workroom-admin', '10001'), seed('workroom-admin', 'owner')], people, logger });
    await store.grant({ level: 'global', key: '', adapter: 'qq', userId: 'owner', role: 'owner' });
    const state = await book.run({ seeds: [seed('user:u1', '10001'), seed('user:u1', '20002'), seed('user:u-op', 'owner')], people, logger });
    const by = (userId: string) => state.entries.find(entry => entry.subjectId === userId && entry.reason !== 'not-a-user')!;
    // A new identity added together with the correction is a configuration edit: it waits.
    expect(by('20002')).toMatchObject({ status: 'pending', reason: 'needs-confirmation' });
    expect(by('10001')).toMatchObject({ status: 'imported' });
    // The owner's identity is never linked to u-op without a global iam.manage holder.
    expect(by('owner')).toMatchObject({ status: 'pending', reason: 'needs-confirmation' });
    expect(store.principals.linkOfConsoleUser('u-op')).toBeUndefined();
  });

  it('a later entry with an invalid key does not open the exception, and a still-invalid key keeps warning', async () => {
    const { store, people, logs, logger, book } = await setup();
    await book.run({ seeds: [seed('user:u1', '10001')], people, logger });
    await book.run({ seeds: [seed('user:u1', '10001'), seed('bad-key', '30003')], people, logger });
    expect(logs.filter(line => line.includes('bad-key')).at(-1)).toContain('改正后的条目等待 Console 确认');
    const state = await book.run({ seeds: [seed('user:u1', '10001'), seed('user:u2', '30003')], people, logger });
    expect(state.entries.find(entry => entry.consoleUserId === 'u2')).toMatchObject({ status: 'pending', reason: 'needs-confirmation' });
    expect(store.principals.linkOfConsoleUser('u2')).toBeUndefined();
    logs.length = 0;
    await book.run({ seeds: [seed('workroom', '10001')], people, logger });
    expect(logs.some(line => line.includes('workroom') && line.includes('不是 Console 用户'))).toBe(true);
    expect(logs.some(line => line.includes('已导入为'))).toBe(false);
  });

  it('a post-migration entry whose adapter was not loaded waits once it is (no unknown-adapter bypass)', async () => {
    const { store, people, logger, book } = await setup();
    await book.run({ seeds: [seed('user:u1', '10001')], people, logger });
    await book.run({ seeds: [seed('user:u2', '40004', { identity: undefined })], people, logger });
    const state = await book.run({ seeds: [seed('user:u2', '40004')], people, logger });
    expect(state.entries.find(entry => entry.consoleUserId === 'u2')).toMatchObject({ status: 'pending', reason: 'needs-confirmation' });
    expect(store.principals.linkOfConsoleUser('u2')).toBeUndefined();
  });

  const writeLegacy = async (root: string, migratedAt: number, entries: readonly Record<string, unknown>[]) => {
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(join(root, '.zhin'), { recursive: true });
    await writeFile(join(root, PERSONAL_PRINCIPALS_IMPORT_FILE), JSON.stringify({ version: 1, migratedAt, entries }));
  };
  const legacy = (key: string, extra: Record<string, unknown>, subjectId = '10001') => ({ id: personalPrincipalImportId({ key, adapterId: 'qq-cap\0bot', subjectId }),
    consoleUserId: key.replace(/^user:/u, ''), adapterId: 'qq-cap\0bot', subjectId, ...extra });

  it('review of #1288: an identity the owner ignored in 1.4.0 is never corrected into a link', async () => {
    const { store, people, logs, logger, book, root } = await setup();
    await writeLegacy(root, 50, [
      legacy('workroom-admin', { status: 'skipped', reason: 'not-a-user', at: 50 }),
      legacy('user:u1', { status: 'skipped', reason: 'ignored', adapter: 'qq', at: 70 }),
    ]);
    const state = await book.run({ seeds: [seed('user:u1', '10001'), seed('user:u2', '10001'), seed('workroom-admin', '10001')], people, logger });
    expect(store.principals.linkOfConsoleUser('u1')).toBeUndefined();
    expect(store.principals.linkOfConsoleUser('u2')).toBeUndefined();
    expect(state.entries.find(entry => entry.consoleUserId === 'u1')).toMatchObject({ status: 'skipped', reason: 'ignored' });
    expect(state.entries.find(entry => entry.consoleUserId === 'u2')).toMatchObject({ status: 'pending', reason: 'needs-confirmation' });
    // The warning no longer promises the exemption.
    expect(logs.find(line => line.includes('workroom-admin'))).toContain('改正后的条目等待 Console 确认');
  });

  it('review of #1288: an identity that already waited for confirmation in 1.4.0 keeps waiting', async () => {
    const { store, people, logger, book, root } = await setup();
    await writeLegacy(root, 50, [
      legacy('workroom-admin', { status: 'skipped', reason: 'not-a-user', at: 50 }),
      legacy('user:u1', { status: 'pending', reason: 'needs-confirmation', adapter: 'qq', at: 60 }),
    ]);
    const state = await book.run({ seeds: [seed('user:u1', '10001')], people, logger });
    expect(state.entries.find(entry => entry.consoleUserId === 'u1')).toMatchObject({ status: 'pending', reason: 'needs-confirmation' });
    expect(store.principals.linkOfConsoleUser('u1')).toBeUndefined();
  });

  it('review of #1288: a 1.4.0 unknown-adapter entry added after the first import waits once its adapter loads', async () => {
    const { store, people, logger, book, root } = await setup();
    await writeLegacy(root, 50, [
      legacy('user:u0', { status: 'imported', adapter: 'qq', at: 50 }, '1'),
      legacy('user:u1', { status: 'pending', reason: 'unknown-adapter', at: 80 }),
      legacy('user:u3', { status: 'pending', reason: 'unknown-adapter', at: 50 }, '3'),
    ]);
    const state = await book.run({ seeds: [seed('user:u1', '10001'), seed('user:u3', '3')], people, logger });
    expect(state.entries.find(entry => entry.consoleUserId === 'u1')).toMatchObject({ status: 'pending', reason: 'needs-confirmation' });
    expect(store.principals.linkOfConsoleUser('u1')).toBeUndefined();
    // Stamped by the first import itself: still part of it.
    expect(state.entries.find(entry => entry.consoleUserId === 'u3')).toMatchObject({ status: 'imported' });
  });

  it('review of #1288: one correction per identity, even when several invalid keys named it', async () => {
    const { store, people, logger, book } = await setup();
    await book.run({ seeds: [seed('admin-a', '10001'), seed('admin-b', '10001')], people, logger });
    const state = await book.run({ seeds: [seed('user:u1', '10001'), seed('user:u2', '10001')], people, logger });
    expect(state.entries.find(entry => entry.consoleUserId === 'u1')).toMatchObject({ status: 'imported' });
    expect(state.entries.find(entry => entry.consoleUserId === 'u2')).toMatchObject({ status: 'pending', reason: 'needs-confirmation' });
    expect(state.entries.filter(entry => entry.reason === 'not-a-user').map(entry => entry.correctedBy)).toEqual([expect.any(String), expect.any(String)]);
    expect(store.principals.linkOfConsoleUser('u2')).toBeUndefined();
  });

  it('review of #1288: the exemption ends 30 days after the first import', async () => {
    const { store, people, logs, logger, root } = await setup();
    let now = 1_000;
    const book = new PersonalPrincipalImportBook({ projectRoot: root, now: () => now });
    await book.run({ seeds: [seed('workroom-admin', '10001'), seed('workroom-admin', '10002')], people, logger });
    now += PERSONAL_PRINCIPAL_CORRECTION_WINDOW_MS + 1;
    logs.length = 0;
    await book.run({ seeds: [seed('workroom-admin', '10002')], people, logger });
    expect(logs.find(line => line.includes('workroom-admin'))).toContain('改正后的条目等待 Console 确认');
    const state = await book.run({ seeds: [seed('user:u1', '10001')], people, logger });
    expect(state.entries.find(entry => entry.consoleUserId === 'u1')).toMatchObject({ status: 'pending', reason: 'needs-confirmation' });
    expect(store.principals.linkOfConsoleUser('u1')).toBeUndefined();
  });

  it('review of #1288: inside the window a correction whose adapter is not loaded yet waits without consuming the identity', async () => {
    const { store, people, logger, root } = await setup();
    let now = 1_000;
    const book = new PersonalPrincipalImportBook({ projectRoot: root, now: () => now });
    await book.run({ seeds: [seed('workroom-admin', '10001')], people, logger });
    await book.run({ seeds: [seed('user:u1', '10001', { identity: undefined })], people, logger });
    now += 1_000;
    const state = await book.run({ seeds: [seed('user:u1', '10001')], people, logger });
    expect(state.entries.find(entry => entry.consoleUserId === 'u1')).toMatchObject({ status: 'imported' });
    expect(store.principals.linkOfConsoleUser('u1')).toBeDefined();
  });

  it('review of #1288: resolving an identity in the Console (ignore) consumes its correction', async () => {
    const { store, people, logger, book } = await setup();
    await book.run({ seeds: [seed('user:u0', '1'), seed('workroom-admin', '10001')], people, logger });
    // Linking onto a person who holds grants waits even inside the correction exemption.
    await store.grant({ level: 'global', key: '', adapter: 'qq', userId: '10001', role: 'owner' });
    const waiting = await book.run({ seeds: [seed('user:u1', '10001')], people, logger });
    const pending = waiting.entries.find(entry => entry.consoleUserId === 'u1')!;
    expect(pending).toMatchObject({ status: 'pending', reason: 'needs-confirmation' });
    expect(await book.resolve({ id: pending.id, decision: 'ignore', people, actor: 'user:root' })).toEqual({ status: 'ignored' });
    const after = await book.read();
    expect(after.entries.find(entry => entry.reason === 'not-a-user')!.correctedBy).toBe(pending.id);
    // Without the grant a fresh correction would otherwise import by itself.
    expect(await store.revoke({ level: 'global', key: '', adapter: 'qq', userId: '10001' })).toBe('saved');
    const again = await book.run({ seeds: [seed('user:u2', '10001')], people, logger });
    expect(again.entries.find(entry => entry.consoleUserId === 'u2')).toMatchObject({ status: 'pending', reason: 'needs-confirmation' });
  });

  it('names the account in the log, so one openid on two accounts is two lines (#1250 chat-roles-import-log-ambiguous)', async () => {
    const { people, logs, logger, book } = await setup();
    await book.run({ seeds: [], people, logger });
    await book.run({ seeds: [at('qq-cap\0qq~102069707', 'user:u1', 'EA15'), at('qq-cap\0qq~1905256660', 'user:u1', 'EA15')], people, logger });
    const lines = logs.filter(line => line.includes('等待 Console 确认'));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('qq:EA15（账号 102069707）');
    expect(lines[1]).toContain('qq:EA15（账号 1905256660）');
    expect(personalPrincipalSourceLabel({ adapterId: 'qq-cap', subjectId: 'x', adapter: 'qq' })).toBe('qq:x');
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
    expect(item.detail).toContain('Console 用户 #u-op 将链接 1 个聊天身份：qq（尾号 wner）');
    expect(item.detail).not.toContain('已从配置文件移除');
  });

  it('groups waiting links by person with each account, masks platform ids and counts distinct identities (#1250 principal-link-attention-ids)', async () => {
    const owner = 'f'.repeat(32);
    const pending = [
      { id: 'a'.repeat(24), consoleUserId: owner, adapter: 'icqq', endpoint: '1689919782', userId: '1659488338', at: 5 },
      { id: 'b'.repeat(24), consoleUserId: owner, adapter: 'qq', endpoint: 'bot-a', userId: 'A1B2C3D4E5F6OPENID0001', at: 6 },
      { id: 'c'.repeat(24), consoleUserId: owner, adapter: 'qq', endpoint: 'bot-b', userId: 'A1B2C3D4E5F6OPENID0002', at: 7 },
      { id: 'd'.repeat(24), consoleUserId: owner, adapter: 'sandbox', userId: 'sandbox-user', at: 8 },
      // The same identity listed twice counts once.
      { id: 'e'.repeat(24), consoleUserId: owner, adapter: 'qq', endpoint: 'bot-b', userId: 'A1B2C3D4E5F6OPENID0002', at: 9 },
    ];
    const read = async (viewer: Record<string, string>) => (await collectAttention({ chatRoles: async () => state({ personal: undefined,
      personalPending: pending }) }, { allows, ...viewer })).items.find(entry => entry.kind === 'chat-roles.import-pending')!;
    const item = await read({ viewerUserId: owner, viewerName: '管理员小王' });
    expect(item.title).toBe('配置中有 4 条人员名单或身份链接等待确认');
    expect(item.detail).toContain('你（管理员小王） 将链接 4 个聊天身份：icqq·1689919782（尾号 8338）、qq·bot-a（尾号 0001）、qq·bot-b（尾号 0002）、sandbox（尾号 user）');
    // No full platform id or hex user id on the home page.
    for (const secret of ['1659488338', 'A1B2C3D4E5F6OPENID0001', 'A1B2C3D4E5F6OPENID0002', owner]) expect(item.detail).not.toContain(secret);
    // The Console names users from `links` (the instance cannot read gateway.db).
    expect(item.links).toEqual([{ consoleUserId: owner, identities: [
      { adapter: 'icqq', endpoint: '1689919782', userIdTail: '8338' }, { adapter: 'qq', endpoint: 'bot-a', userIdTail: '0001' },
      { adapter: 'qq', endpoint: 'bot-b', userIdTail: '0002' }, { adapter: 'sandbox', userIdTail: 'user' }] }]);
    const other = await read({ viewerUserId: 'someone-else' });
    expect(other.detail).toContain(`Console 用户 #${owner.slice(0, 8)} 将链接 4 个聊天身份`);
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
