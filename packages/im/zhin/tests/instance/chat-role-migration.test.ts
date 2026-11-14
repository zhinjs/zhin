import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyConfigPatches, type ConfigDocumentPort, type ConfigPatch } from '@zhin.js/plugin-runtime';
import { ChatRoleService, ChatRoleStore, type InstanceChatRoleService } from '../../src/instance/chat-roles.js';
import {
  CHAT_ROLE_MIGRATION_FILE, CHAT_ROLE_MIGRATION_V1_BACKUP, ChatRoleImportBook, LegacyChatRoleConfigError, chatRoleImportId,
  chatRoleMigrationAdapterKinds, prepareChatRoleMigration,
} from '../../src/instance/chat-role-migration.js';

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

const legacyDocument = () => ({
  configVersion: 2,
  plugins: { qq: '@x/qq', sandbox: '@x/sandbox', lab: '@x/lab' },
  qq: { master: 'base', endpoints: [{ id: 'bot-1' }, { id: 'bot-2', master: 'leaf' }] },
  sandbox: { endpoints: [{ id: 'local' }] },
  lab: { endpoints: [{ id: 'x' }] },
  ai: { trigger: { masters: ['root'], trusted: ['helper'] } },
});

function configPort(initial: Record<string, unknown>) {
  const state = { document: structuredClone(initial) as Record<string, unknown>, commits: 0, failCommit: false };
  const port: ConfigDocumentPort = {
    async read() { return { document: structuredClone(state.document), revision: String(state.commits) } as never; },
    async prepare(_current, patches: readonly ConfigPatch[]) {
      return { commit: async () => {
        if (state.failCommit) throw new Error('crash while editing the configuration');
        state.document = applyConfigPatches(state.document as never, patches as never) as never;
        state.commits += 1;
      } } as never;
    },
  };
  return { port, state };
}

function logger() {
  const lines: string[] = [];
  return { lines, logger: { info: (line: string) => { lines.push(`info ${line}`); }, warn: (line: string) => { lines.push(`warn ${line}`); } } };
}

async function project() {
  const root = await mkdtemp(join(tmpdir(), 'zhin-role-migration-'));
  directories.push(root);
  return root;
}

const record = async (root: string) => JSON.parse(await readFile(join(root, CHAT_ROLE_MIGRATION_FILE), 'utf8')) as Record<string, any>;
const newRoles = (): InstanceChatRoleService => new ChatRoleService({ store: new ChatRoleStore() });
const kinds = (alias: string) => alias === 'sandbox' ? 'simulated' as const : alias === 'qq' ? 'platform' as const : undefined;

describe('prepareChatRoleMigration (ADR 0056 §3)', () => {
  it('pending → done: records first, removes the fields, writes grants, then refuses the fields', async () => {
    const root = await project();
    const { port, state } = configPort(legacyDocument());
    const log = logger();
    const migration = await prepareChatRoleMigration({ projectRoot: root, config: port, expand: document => document, logger: log.logger, now: () => 1 });
    expect((await record(root)).status).toBe('pending');
    expect(state.document.ai).toEqual({ trigger: {} });
    expect((state.document.qq as Record<string, unknown>).master).toBeUndefined();
    const roles = newRoles();
    await migration.complete(roles, { persistent: true, adapterKind: kinds });
    expect(roles.store.list().map(entry => `${entry.level}:${entry.key}:${entry.adapter}:${entry.userId}:${entry.role}`).sort()).toEqual([
      // Adapter master → only the account without its own master; never an adapter-level owner.
      'endpoint:qq/bot-1:qq:base:owner',
      'endpoint:qq/bot-2:qq:leaf:owner',
      // ai.trigger.* only on real platform adapters: not on the simulation, not on an unknown one.
      'global::qq:helper:trusted',
      'global::qq:root:owner',
    ]);
    expect(log.lines.some(line => line.startsWith('info') && line.includes('sandbox') && line.includes('local simulation'))).toBe(true);
    expect(log.lines.some(line => line.startsWith('warn') && line.includes('lab') && line.includes('unknown'))).toBe(true);
    expect(await record(root)).toMatchObject({ status: 'done', completedAt: 1, version: 2 });
    expect((await record(root)).imported.map((entry: { source: string; result: string }) => `${entry.source}:${entry.result}`))
      .toContain('ai.trigger.masters:written');
    // ADR 0060 §4.2: the fields no longer stop startup; they wait for a Console decision instead.
    const again = configPort({ ...legacyDocument(), ai: { trigger: { masters: ['root', 'intruder'] } } });
    const later = await prepareChatRoleMigration({ projectRoot: root, config: again.port, expand: document => document, logger: log.logger, now: () => 5 });
    expect(later.pending).toEqual([]);
    expect(again.state.document.ai).toEqual({ trigger: {} });
    const candidates = (await record(root)).pendingImports as { source: string; userId: string; seenAt: number }[];
    expect(candidates.some(entry => entry.userId === 'intruder' && entry.source === 'ai.trigger.masters' && entry.seenAt === 5)).toBe(true);
    expect(log.lines.some(line => line.startsWith('warn') && line.includes('NOT granted'))).toBe(true);
    // Nothing was granted to the new name.
    await later.complete(roles, { persistent: true, adapterKind: kinds });
    expect(roles.hasRole({ adapter: 'qq', userId: 'intruder' }, '', 'trusted')).toBe(false);
    // Unsupported fields still stop startup.
    const mapping = configPort({ ...legacyDocument(), qq: { roles: { mappings: [] }, endpoints: [] } });
    await expect(prepareChatRoleMigration({ projectRoot: root, config: mapping.port, expand: document => document, logger: log.logger }))
      .rejects.toBeInstanceOf(LegacyChatRoleConfigError);
  });

  it('replays a pending record after a crash, keeps stored roles and finishes once', async () => {
    const root = await project();
    const { port, state } = configPort(legacyDocument());
    state.failCommit = true;
    const log = logger();
    await expect(prepareChatRoleMigration({ projectRoot: root, config: port, expand: document => document, logger: log.logger })).rejects.toThrow('crash');
    expect((await record(root)).status).toBe('pending');
    // Next start: configuration still has the fields (the edit never landed), the record is replayed.
    state.failCommit = false;
    const migration = await prepareChatRoleMigration({ projectRoot: root, config: port, expand: document => document, logger: log.logger });
    expect(migration.pending.length).toBeGreaterThan(0);
    expect((state.document.qq as Record<string, unknown>).master).toBeUndefined();
    const roles = newRoles();
    await roles.store.grant({ level: 'endpoint', key: 'qq/bot-1', adapter: 'qq', userId: 'base', role: 'trusted' });
    await roles.store.grant({ level: 'endpoint', key: 'qq/bot-2', adapter: 'qq', userId: 'leaf', role: 'owner' });
    await migration.complete(roles, { adapterKind: kinds });
    // ADR 0060 §4.3: the higher role wins — a lower stored role is raised, never lowered or removed.
    expect(roles.store.get('endpoint', 'qq/bot-1', { adapter: 'qq', userId: 'base' })?.role).toBe('owner');
    expect(roles.store.get('endpoint', 'qq/bot-2', { adapter: 'qq', userId: 'leaf' })?.grantedBy).toBeUndefined();
    expect((await record(root)).imported.find((entry: { userId: string }) => entry.userId === 'base').result).toBe('upgraded');
    expect((await record(root)).status).toBe('done');
    // Configuration without the fields: nothing pending, complete is a no-op.
    const later = await prepareChatRoleMigration({ projectRoot: root, config: port, expand: document => document, logger: log.logger });
    expect(later.pending).toEqual([]);
  });

  it('without a relational database applies grants in memory only and keeps the record pending', async () => {
    const root = await project();
    const { port } = configPort(legacyDocument());
    const log = logger();
    const migration = await prepareChatRoleMigration({ projectRoot: root, config: port, expand: document => document, logger: log.logger, now: () => 7 });
    const database = { dialect: 'memory', started: true, models: new Map() } as never;
    const roles: InstanceChatRoleService = new ChatRoleService({ store: new ChatRoleStore({ database }) });
    await migration.complete(roles, { persistent: false, adapterKind: kinds });
    expect(roles.hasRole({ adapter: 'qq', userId: 'root' }, '', 'owner')).toBe(true);
    expect(await record(root)).toMatchObject({ status: 'pending', memoryOnlyAt: 7 });
    // Revocation is refused there, so a migrated role cannot be "revoked" and come back on the next start.
    await expect(roles.store.revoke({ level: 'global', key: '', adapter: 'qq', userId: 'root' })).rejects.toMatchObject({ code: 'chat-roles-unpersisted' });
    expect(log.lines.some(line => line.startsWith('warn') && line.includes('in memory only'))).toBe(true);
  });

  it('classifies adapters by their capability profile (runtime.sandbox), never by name', () => {
    const snapshot = {
      tree: new Map([['root/a', { instanceKey: 'local' }], ['root/b', { instanceKey: 'qq' }]]),
      projections: new Map([['zhin.adapter', {
        $projection: 'zhin.adapter-index/1',
        describe: () => [{ id: 'a:1', owner: 'root/a' }, { id: 'b:1', owner: 'root/b' }],
        capabilityProfile: (id: string) => id.startsWith('a:') ? { default: { runtime: { sandbox: true } } } : { default: {} },
      }]]),
    };
    const classify = chatRoleMigrationAdapterKinds(snapshot as never);
    expect(classify('local')).toBe('simulated');
    expect(classify('qq')).toBe('platform');
    expect(classify('missing')).toBeUndefined();
    // No snapshot: everything stays unknown (fail closed).
    expect(chatRoleMigrationAdapterKinds(undefined)('qq')).toBeUndefined();
  });
});

describe('configuration import (ADR 0060 §4)', () => {
  async function doneProject(document = legacyDocument()) {
    const root = await project();
    const log = logger();
    const first = await prepareChatRoleMigration({ projectRoot: root, config: configPort(document).port, expand: value => value, logger: log.logger, now: () => 1 });
    const roles = newRoles();
    await first.complete(roles, { persistent: true, adapterKind: kinds });
    return { root, roles, log };
  }

  it('keeps a version 1 record as .v1.json and reads it (rollback)', async () => {
    const root = await project();
    const v1 = { version: 1, status: 'done', grants: [], startedAt: 1, completedAt: 2 };
    await mkdir(join(root, '.zhin'), { recursive: true });
    await writeFile(join(root, CHAT_ROLE_MIGRATION_FILE), JSON.stringify(v1), 'utf8');
    const log = logger();
    await prepareChatRoleMigration({ projectRoot: root, config: configPort({ ...legacyDocument(), ai: { trigger: { masters: ['x'] } } }).port,
      expand: value => value, logger: log.logger, now: () => 3 });
    expect(JSON.parse(await readFile(join(root, CHAT_ROLE_MIGRATION_V1_BACKUP), 'utf8'))).toEqual(v1);
    expect(await record(root)).toMatchObject({ version: 2, status: 'done', completedAt: 2 });
  });

  it('records a re-appeared field once (idempotent) and imports it only on a Console decision, audited', async () => {
    const { root, roles, log } = await doneProject();
    const document = { ...legacyDocument(), ai: { trigger: { masters: ['newcomer'] } } };
    for (let start = 0; start < 2; start += 1) {
      await prepareChatRoleMigration({ projectRoot: root, config: configPort(document).port, expand: value => value, logger: log.logger, now: () => 10 + start });
    }
    const audits: Record<string, unknown>[] = [];
    const book = new ChatRoleImportBook({ projectRoot: root, roles: () => roles, adapterKind: () => kinds, audit: entry => { audits.push(entry); } });
    const state = await book.read();
    const candidates = state.pending.filter(entry => entry.userId === 'newcomer');
    // One candidate per configured adapter alias, recorded once across two starts.
    expect(candidates.map(entry => `${entry.adapter}:${entry.seenAt}`).sort()).toEqual(['lab:10', 'qq:10', 'sandbox:10']);
    expect(roles.hasRole({ adapter: 'qq', userId: 'newcomer' }, '', 'owner')).toBe(false);
    const qq = candidates.find(entry => entry.adapter === 'qq')!;
    expect(qq.id).toBe(chatRoleImportId(qq));
    expect(await book.resolve({ id: qq.id, decision: 'import', actor: 'user:7' })).toMatchObject({ status: 'imported', result: 'written' });
    expect(roles.store.get('global', '', { adapter: 'qq', userId: 'newcomer' })).toMatchObject({ role: 'owner', grantedBy: 'user:7' });
    expect(audits.at(-1)).toMatchObject({ actor: 'user:7', action: 'chat-roles.import', outcome: 'ok',
      detail: { source: 'ai.trigger.masters', decision: 'import', result: 'written' } });
    // Resolved once: a second decision on the same id finds nothing.
    expect(await book.resolve({ id: qq.id, decision: 'import', actor: 'user:7' })).toEqual({ status: 'not-found' });
    // A simulation adapter never receives a global grant, even on import.
    const sandbox = candidates.find(entry => entry.adapter === 'sandbox')!;
    expect(await book.resolve({ id: sandbox.id, decision: 'import', actor: 'user:7' })).toMatchObject({ result: 'skipped', reason: 'simulated' });
    expect(roles.hasRole({ adapter: 'sandbox', userId: 'newcomer' }, '', 'trusted')).toBe(false);
    // Ignore drops the candidate without granting.
    const lab = candidates.find(entry => entry.adapter === 'lab')!;
    expect(await book.resolve({ id: lab.id, decision: 'ignore', actor: 'user:7' })).toMatchObject({ status: 'ignored' });
    expect(audits.at(-1)).toMatchObject({ detail: { decision: 'ignore' } });
    expect((await book.read()).pending.filter(entry => entry.userId === 'newcomer')).toEqual([]);
  });

  it('never lowers a stored role on import (downgrade protection)', async () => {
    const { root, roles, log } = await doneProject();
    await prepareChatRoleMigration({ projectRoot: root, config: configPort({ ...legacyDocument(), ai: { trigger: { trusted: ['root'] } } }).port,
      expand: value => value, logger: log.logger });
    const book = new ChatRoleImportBook({ projectRoot: root, roles: () => roles, adapterKind: () => kinds });
    const candidate = (await book.read()).pending.find(entry => entry.adapter === 'qq' && entry.userId === 'root')!;
    expect(await book.resolve({ id: candidate.id, decision: 'import', actor: 'user:1' })).toMatchObject({ status: 'imported', result: 'kept' });
    expect(roles.store.get('global', '', { adapter: 'qq', userId: 'root' })?.role).toBe('owner');
  });

  it('refuses an import without a relational database and keeps the candidate', async () => {
    const { root, log } = await doneProject();
    await prepareChatRoleMigration({ projectRoot: root, config: configPort({ ...legacyDocument(), ai: { trigger: { masters: ['m'] } } }).port,
      expand: value => value, logger: log.logger });
    const database = { dialect: 'memory', started: true, models: new Map() } as never;
    const memory: InstanceChatRoleService = new ChatRoleService({ store: new ChatRoleStore({ database }) });
    const book = new ChatRoleImportBook({ projectRoot: root, roles: () => memory, adapterKind: () => kinds });
    const candidate = (await book.read()).pending[0]!;
    await expect(book.resolve({ id: candidate.id, decision: 'import', actor: 'user:1' })).rejects.toMatchObject({ code: 'chat-roles-unpersisted' });
    expect((await book.read()).pending.some(entry => entry.id === candidate.id)).toBe(true);
  });

  it('acknowledges the first import once', async () => {
    const { root, roles } = await doneProject();
    const book = new ChatRoleImportBook({ projectRoot: root, roles: () => roles, adapterKind: () => kinds, now: () => 99 });
    expect((await book.read()).imported.length).toBeGreaterThan(0);
    expect(await book.acknowledge('user:1')).toBe('saved');
    expect(await book.acknowledge('user:1')).toBe('unchanged');
    expect((await book.read()).importedAcknowledgedAt).toBe(99);
  });
});
