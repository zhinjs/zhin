import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyConfigPatches, type ConfigDocumentPort, type ConfigPatch } from '@zhin.js/plugin-runtime';
import { ChatRoleService, ChatRoleStore, type InstanceChatRoleService } from '../../src/instance/chat-roles.js';
import {
  CHAT_ROLE_MIGRATION_FILE, LegacyChatRoleConfigError, chatRoleMigrationAdapterKinds, prepareChatRoleMigration,
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
    expect(await record(root)).toMatchObject({ status: 'done', completedAt: 1 });
    // The old fields are refused from now on.
    const again = configPort({ ...legacyDocument(), ai: { trigger: { masters: ['root'] } } });
    await expect(prepareChatRoleMigration({ projectRoot: root, config: again.port, expand: document => document, logger: log.logger }))
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
    await migration.complete(roles, { adapterKind: kinds });
    // A role already stored at the same scope is kept.
    expect(roles.store.get('endpoint', 'qq/bot-1', { adapter: 'qq', userId: 'base' })?.role).toBe('trusted');
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
