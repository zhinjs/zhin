import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openGatewayStore, ProjectDatabase, type GatewayStore, type ProjectDatabaseConfig } from '../../src/database/index.js';
import {
  importLegacyIamTables,
  inspectLegacyIamImport,
  isTransientLegacyImportError,
  LegacyImportError,
  resetGatewayStore,
  readLegacyImportRecord,
  revertLegacyIamImport,
  tableChecksum,
  type LegacyIamSource,
} from '../../src/iam/legacy-import.js';
import { ConsoleIamService } from '../../src/iam/service.js';
import { defineConsoleIamTables, IAM_TABLES } from '../../src/iam/tables.js';

/** ADR 0059 §3: the account tables of an earlier version move from the project database into gateway.db. */
const PASSWORD = 'correct-horse-battery';
const dirs: string[] = [];
const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close().catch(() => undefined);
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

async function project() {
  const root = await mkdtemp(join(tmpdir(), 'zhin-legacy-import-'));
  dirs.push(root);
  const config: ProjectDatabaseConfig = { dialect: 'sqlite', filename: join(root, '.zhin', 'data.sqlite') };
  return { root, config };
}

/** What an earlier version left: owner + viewer, a session, an API token and audit rows in the project database. */
async function seedLegacy(config: ProjectDatabaseConfig, root: string) {
  const legacy = new ProjectDatabase(config);
  defineConsoleIamTables(legacy);
  legacy.define('notes', { id: { type: 'integer', primary: true }, body: { type: 'text' } });
  await legacy.start();
  const iam = new ConsoleIamService({ database: legacy, projectRoot: root });
  await iam.start({ timers: false });
  const owner = await iam.createOwner({ username: 'owner', password: PASSWORD });
  await iam.createUser({ username: 'viewer', password: PASSWORD, bindings: [{ role: 'viewer' }] });
  const session = await iam.login('owner', PASSWORD);
  const token = await iam.createToken(owner.id, { name: 'automation', permissions: ['status.view'] });
  iam.audit({ actor: `user:${owner.id}`, action: 'test', outcome: 'ok' });
  await new Promise(resolve => setTimeout(resolve, 20));
  iam.stop();
  await legacy.models.get('notes')!.insert({ id: 1, body: 'plugin data stays' });
  await legacy.stop();
  return { owner, session: session.token, apiToken: token.token };
}

async function store(root: string): Promise<GatewayStore> {
  const opened = await openGatewayStore(root);
  closers.push(() => opened.close());
  return opened;
}

async function legacyTables(config: ProjectDatabaseConfig): Promise<string[]> {
  const source = new ProjectDatabase(config);
  await source.start();
  try {
    return await source.tableExists([...Object.values(IAM_TABLES), 'notes']);
  } finally {
    await source.stop();
  }
}

/** Wraps the default source; `failDrop` makes the drop step fail that many times. */
function flakySource(state: { failDrop: number; failStart?: boolean; mutate?: (rows: Record<string, unknown>) => Record<string, unknown> }) {
  return (config: ProjectDatabaseConfig): LegacyIamSource => {
    const inner = new ProjectDatabase(config);
    return {
      dialect: config.dialect,
      start: async () => {
        if (state.failStart) throw new Error('connect ECONNREFUSED 127.0.0.1:5432');
        await inner.start();
      },
      stop: () => inner.stop(),
      tableExists: names => inner.tableExists(names),
      readSnapshot: async (tables) => {
        const rows = await inner.readSnapshot(tables);
        if (!state.mutate) return rows;
        return Object.fromEntries(Object.entries(rows).map(([table, list]) => [table, list.map(row => state.mutate!(row))]));
      },
      dropTables: async (tables) => {
        if (state.failDrop > 0) {
          state.failDrop -= 1;
          throw new Error('connection lost while dropping');
        }
        await inner.dropTables(tables);
      },
    };
  };
}

describe('importLegacyIamTables', () => {
  it('records fresh without touching a project that has no old tables (or no file, or no relational database)', async () => {
    const { root, config } = await project();
    const target = await store(root);
    const record = await importLegacyIamTables({ store: target, projectRoot: root, projectDatabase: async () => config });
    expect(record).toMatchObject({ status: 'fresh', reason: 'no-database-file', source: { dialect: 'sqlite', location: join('.zhin', 'data.sqlite') } });
    // The file is then created for the store marker only (no console_* table in it).
    expect(existsSync(config.filename as string)).toBe(true);
    expect(await legacyTables(config)).toEqual([]);

    const other = await project();
    const existing = new ProjectDatabase(other.config);
    existing.define('notes', { id: { type: 'integer', primary: true } });
    await existing.start();
    await existing.stop();
    const otherStore = await store(other.root);
    expect(await importLegacyIamTables({ store: otherStore, projectRoot: other.root, projectDatabase: async () => other.config })).toMatchObject({ status: 'fresh', reason: 'no-tables' });
    // No empty console_* table is created in the project database.
    expect(await legacyTables(other.config)).toEqual(['notes']);

    const redis = await project();
    const redisStore = await store(redis.root);
    expect(await importLegacyIamTables({ store: redisStore, projectRoot: redis.root, projectDatabase: async () => ({ dialect: 'redis' }) }))
      .toMatchObject({ status: 'fresh', reason: 'non-relational', source: { dialect: 'redis' } });
  });

  it('moves accounts, sessions and API tokens; old credentials keep working; the old tables are dropped', async () => {
    const { root, config } = await project();
    const seeded = await seedLegacy(config, root);
    const target = await store(root);
    const record = await importLegacyIamTables({ store: target, projectRoot: root, projectDatabase: async () => config });
    expect(record).toMatchObject({
      status: 'done',
      changed: false,
      counts: { [IAM_TABLES.users]: 2, [IAM_TABLES.sessions]: 1, [IAM_TABLES.tokens]: 1, [IAM_TABLES.roles]: 4 },
    });
    // Plugin data stays where it was; the account tables are gone from the project database.
    expect(await legacyTables(config)).toEqual(['notes']);
    // Backup of every row, owner-only.
    const backup = join(root, record.status === 'done' ? record.backup : '', 'console-tables.json');
    if (process.platform !== 'win32') expect(statSync(backup).mode & 0o777).toBe(0o600);
    const exported = JSON.parse(readFileSync(backup, 'utf8')) as { tables: Record<string, unknown[]> };
    expect(exported.tables[IAM_TABLES.users]).toHaveLength(2);

    const iam = new ConsoleIamService({ database: target, projectRoot: root });
    await iam.start({ timers: false });
    closers.push(async () => { iam.stop(); });
    expect(iam.initialized()).toBe(true);
    expect(await iam.authenticate(seeded.session)).toMatchObject({ kind: 'user', userId: seeded.owner.id });
    expect(await iam.authenticate(seeded.apiToken)).toMatchObject({ kind: 'api-token' });
    expect((await iam.login('viewer', PASSWORD)).token).toMatch(/\S/);
    expect((await iam.listAudit({})).entries.some(entry => entry.action === 'test')).toBe(true);

    // Idempotent: nothing to do the second time.
    expect(await importLegacyIamTables({ store: target, projectRoot: root, projectDatabase: async () => { throw new Error('not read again'); } })).toEqual(record);
  });

  it('resumes from copied when the drop step was interrupted, and reports old tables that changed meanwhile', async () => {
    const { root, config } = await project();
    await seedLegacy(config, root);
    const target = await store(root);
    const state = { failDrop: 1 };
    await expect(importLegacyIamTables({ store: target, projectRoot: root, projectDatabase: async () => config, openSource: flakySource(state) }))
      .rejects.toThrow(/connection lost/);
    expect(await readLegacyImportRecord(target)).toMatchObject({ status: 'copied' });
    // An old version wrote to the old tables after the copy.
    const legacy = new ProjectDatabase(config);
    await legacy.start();
    await legacy.query(`UPDATE ${IAM_TABLES.users} SET display_name = 'changed' WHERE username = 'viewer'`);
    await legacy.stop();
    const record = await importLegacyIamTables({ store: target, projectRoot: root, projectDatabase: async () => config, openSource: flakySource(state) });
    expect(record).toMatchObject({ status: 'done', changed: true });
    const changed = JSON.parse(readFileSync(join(root, record.status === 'done' ? record.changedExport! : ''), 'utf8')) as { tables: Record<string, Array<{ display_name: string }>> };
    expect(changed.tables[IAM_TABLES.users]!.map(row => row.display_name)).toContain('changed');
    expect(await legacyTables(config)).toEqual(['notes']);
    // gateway.db keeps the copy.
    expect((await target.query<Array<{ display_name: string }>>(`SELECT display_name FROM ${IAM_TABLES.users} WHERE username = 'viewer'`))[0]!.display_name).not.toBe('changed');
  });

  it('writes nothing when the project database is unreachable, and refuses to merge into a non-empty store', async () => {
    const { root, config } = await project();
    await seedLegacy(config, root);
    const target = await store(root);
    const unreachable = importLegacyIamTables({ store: target, projectRoot: root, projectDatabase: async () => config, openSource: flakySource({ failDrop: 0, failStart: true }) });
    await expect(unreachable).rejects.toSatisfy((error: unknown) => error instanceof LegacyImportError && error.code === 'unavailable');
    expect(await readLegacyImportRecord(target)).toBeUndefined();
    expect(Object.values(await target.counts()).every(count => count === 0)).toBe(true);

    await target.query(`INSERT INTO ${IAM_TABLES.roles} (id, name, description, builtin, permissions) VALUES ('r', 'x', '', 0, '[]')`);
    await expect(importLegacyIamTables({ store: target, projectRoot: root, projectDatabase: async () => config }))
      .rejects.toSatisfy((error: unknown) => error instanceof LegacyImportError && error.code === 'conflict');
    expect(await legacyTables(config)).toContain(IAM_TABLES.users);
  });

  it('rolls the copy back when it does not read back identically', async () => {
    const { root, config } = await project();
    await seedLegacy(config, root);
    const target = await store(root);
    // A source row without an id cannot be copied verifiably.
    const failing = importLegacyIamTables({
      store: target, projectRoot: root, projectDatabase: async () => config,
      openSource: flakySource({ failDrop: 0, mutate: ({ id: _id, ...row }) => row }),
    });
    await expect(failing).rejects.toSatisfy((error: unknown) => error instanceof LegacyImportError && error.code === 'invalid');
    // Not retried automatically: recorded for zhin doctor.
    expect(isTransientLegacyImportError(await failing.catch((error: unknown) => error))).toBe(false);
    expect(await target.getMeta('legacy_import_failure')).toMatchObject({ code: 'invalid', message: expect.stringContaining('没有 id 列') });
    expect(await readLegacyImportRecord(target)).toBeUndefined();
    expect(Object.values(await target.counts()).every(count => count === 0)).toBe(true);
    expect(await legacyTables(config)).toContain(IAM_TABLES.users);
  });

  it('hashes PostgreSQL bigint strings and numbers alike, null kept', () => {
    const asNumbers = [{ id: 's1', user_id: 'u', created_at: 1_700_000_000_000, expires_at: 1, last_seen_at: 2, ip: null, user_agent: null }];
    const asStrings = [{ id: 's1', user_id: 'u', created_at: '1700000000000', expires_at: '1', last_seen_at: '2', ip: null, user_agent: null }];
    expect(tableChecksum(IAM_TABLES.sessions, asStrings)).toBe(tableChecksum(IAM_TABLES.sessions, asNumbers));
    expect(tableChecksum(IAM_TABLES.sessions, [{ ...asNumbers[0], ip: '' }])).not.toBe(tableChecksum(IAM_TABLES.sessions, asNumbers));
    // Row order does not matter; content does.
    const two = [{ id: 'b', at: 2, actor: 'a', action: 'x', outcome: 'ok' }, { id: 'a', at: 1, actor: 'a', action: 'x', outcome: 'ok' }];
    expect(tableChecksum(IAM_TABLES.audit, two)).toBe(tableChecksum(IAM_TABLES.audit, [...two].reverse()));
  });

  it('copies a PostgreSQL-style source (bigint as strings) into integers', async () => {
    const { root, config } = await project();
    await seedLegacy(config, root);
    const target = await store(root);
    const record = await importLegacyIamTables({
      store: target, projectRoot: root, projectDatabase: async () => config,
      openSource: flakySource({ failDrop: 0, mutate: row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === 'number' ? String(value) : value])) }),
    });
    expect(record.status).toBe('done');
    const [row] = await target.query<Array<{ created_at: unknown }>>(`SELECT created_at FROM ${IAM_TABLES.users} LIMIT 1`);
    expect(typeof row!.created_at).toBe('number');
  });
});

describe('revertLegacyIamImport (zhin console migrate --revert)', () => {
  it('writes the tables back verified, empties gateway.db, and a later import brings them over again', async () => {
    const { root, config } = await project();
    const seeded = await seedLegacy(config, root);
    const target = await store(root);
    await importLegacyIamTables({ store: target, projectRoot: root, projectDatabase: async () => config });
    const reverted = await revertLegacyIamImport({ store: target, projectRoot: root, projectDatabase: async () => config });
    expect(reverted.counts).toMatchObject({ [IAM_TABLES.users]: 2, [IAM_TABLES.sessions]: 1 });
    expect(existsSync(join(root, reverted.backup, 'gateway.db'))).toBe(true);
    expect(Object.values(await target.counts()).every(count => count === 0)).toBe(true);
    expect(await readLegacyImportRecord(target)).toBeUndefined();
    expect(await legacyTables(config)).toEqual(expect.arrayContaining([IAM_TABLES.users, IAM_TABLES.sessions, 'notes']));
    // An older version would find its accounts in the project database.
    const old = new ProjectDatabase(config);
    defineConsoleIamTables(old);
    await old.start();
    const oldIam = new ConsoleIamService({ database: old, projectRoot: root });
    await oldIam.start({ timers: false });
    expect(await oldIam.authenticate(seeded.session)).toMatchObject({ userId: seeded.owner.id });
    oldIam.stop();
    await old.stop();
    // Refuses to overwrite rows already there.
    await expect(revertLegacyIamImport({ store: target, projectRoot: root, projectDatabase: async () => config }))
      .rejects.toSatisfy((error: unknown) => error instanceof LegacyImportError && error.code === 'conflict');
    // Upgrading again migrates again.
    expect(await importLegacyIamTables({ store: target, projectRoot: root, projectDatabase: async () => config })).toMatchObject({ status: 'done', changed: false });
    const iam = new ConsoleIamService({ database: target, projectRoot: root });
    await iam.start({ timers: false });
    closers.push(async () => { iam.stop(); });
    expect(await iam.authenticate(seeded.apiToken)).toMatchObject({ kind: 'api-token' });
  });

  it('refuses a project database that cannot hold accounts', async () => {
    const { root } = await project();
    const target = await store(root);
    await expect(revertLegacyIamImport({ store: target, projectRoot: root, projectDatabase: async () => ({ dialect: 'memory' }) }))
      .rejects.toSatisfy((error: unknown) => error instanceof LegacyImportError && error.code === 'unsupported');
  });
});

describe('inspectLegacyIamImport (zhin doctor)', () => {
  it('reports tables that reappeared in the project database after the import', async () => {
    const { root, config } = await project();
    await seedLegacy(config, root);
    const target = await store(root);
    await importLegacyIamTables({ store: target, projectRoot: root, projectDatabase: async () => config });
    expect(await inspectLegacyIamImport({ store: target, projectRoot: root, projectDatabase: async () => config })).toMatchObject({ reappeared: [] });
    const legacy = new ProjectDatabase(config);
    defineConsoleIamTables(legacy);
    await legacy.start();
    await legacy.stop();
    const inspection = await inspectLegacyIamImport({ store: target, projectRoot: root, projectDatabase: async () => config });
    expect(inspection.reappeared).toEqual(Object.values(IAM_TABLES));
    expect(inspection.record).toMatchObject({ status: 'done' });
  });
});
