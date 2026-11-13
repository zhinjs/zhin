import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openGatewayStore, ProjectDatabase, type ProjectDatabaseConfig } from '../../src/database/index.js';
import { provisionConsoleRole } from '@zhin.js/database';
import { importLegacyIamTables, revertLegacyIamImport } from '../../src/iam/legacy-import.js';
import { ConsoleIamService } from '../../src/iam/service.js';
import { defineConsoleIamTables, IAM_TABLES } from '../../src/iam/tables.js';
import { createLiveMysqlDatabase, createLivePgDatabase } from '../../../../../basic/database/tests/support/live-database.js';

/**
 * ADR 0059 §3 against real servers (full-validation): accounts an earlier version kept in a
 * PostgreSQL / MySQL / MongoDB project database move into gateway.db and back.
 */
const live = process.env.ZHIN_TEST_EXTERNAL_DATABASES === '1';
const PASSWORD = 'correct-horse-battery';

// Each source gets a database of its own (the suite writes markers and `console_*` tables), so
// the live suites can run in parallel.
interface OwnDatabase { config: ProjectDatabaseConfig; adoptRole(name: string): void; drop(): Promise<void> }

const sources: Array<{ name: string; create(): Promise<OwnDatabase> }> = [
  {
    name: 'postgresql',
    async create() {
      const own = await createLivePgDatabase('legacy_import');
      return { config: { dialect: 'pg', ...own.config } as ProjectDatabaseConfig, adoptRole: role => own.adoptRole(role), drop: () => own.drop() };
    },
  },
  ...(process.env.ZHIN_TEST_MYSQL_PORT || process.env.ZHIN_TEST_MYSQL_HOST ? [{
    name: 'mysql',
    async create() {
      const own = await createLiveMysqlDatabase('legacy_import');
      return { config: { dialect: 'mysql', ...own.config } as ProjectDatabaseConfig, adoptRole: role => own.adoptRole(role), drop: () => own.drop() };
    },
  }] : []),
  ...(process.env.ZHIN_TEST_MONGODB_URL ? [{
    name: 'mongodb',
    async create() {
      const dbName = `${process.env.ZHIN_TEST_MONGODB_DATABASE ?? 'zhin_test'}_legacy_${process.pid}_${randomBytes(3).toString('hex')}`;
      return { config: { dialect: 'mongodb', url: process.env.ZHIN_TEST_MONGODB_URL, dbName } as ProjectDatabaseConfig, adoptRole: () => undefined, drop: async () => undefined };
    },
  }] : []),
];

describe.skipIf(!live).each(sources)('legacy import from $name (live)', (source) => {
  let root: string;
  let config: ProjectDatabaseConfig;
  let own: OwnDatabase | undefined;

  async function dropLegacy(): Promise<void> {
    const db = new ProjectDatabase(config);
    await db.start();
    await db.dropTables(Object.values(IAM_TABLES));
    await db.stop();
  }

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'zhin-legacy-live-'));
    own = await source.create();
    config = own.config;
    await dropLegacy();
  });
  afterAll(async () => {
    await dropLegacy().catch(() => undefined);
    await own?.drop();
    await rm(root, { recursive: true, force: true });
  });

  it('imports, keeps credentials working, drops the old tables, and reverts', async () => {
    const legacy = new ProjectDatabase(config);
    defineConsoleIamTables(legacy);
    await legacy.start();
    const old = new ConsoleIamService({ database: legacy, projectRoot: root });
    await old.start({ timers: false });
    const owner = await old.createOwner({ username: 'owner', password: PASSWORD });
    const session = await old.login('owner', PASSWORD);
    const token = await old.createToken(owner.id, { name: 'ci', permissions: ['status.view'] });
    old.stop();
    await legacy.stop();

    const store = await openGatewayStore(root);
    try {
      const record = await importLegacyIamTables({ store, projectRoot: root, projectDatabase: async () => config });
      expect(record).toMatchObject({ status: 'done', changed: false, counts: { [IAM_TABLES.users]: 1, [IAM_TABLES.sessions]: 1, [IAM_TABLES.tokens]: 1 } });
      const check = new ProjectDatabase(config);
      await check.start();
      expect(await check.tableExists(Object.values(IAM_TABLES))).toEqual([]);
      await check.stop();
      // bigint columns (PostgreSQL returns int8 as strings past 2^53, MySQL as strings) land as integers.
      const [row] = await store.query<Array<{ created_at: unknown }>>(`SELECT created_at FROM ${IAM_TABLES.sessions}`);
      expect(typeof row!.created_at).toBe('number');
      const iam = new ConsoleIamService({ database: store, projectRoot: root });
      await iam.start({ timers: false });
      expect(await iam.authenticate(session.token)).toMatchObject({ userId: owner.id });
      expect(await iam.authenticate(token.token)).toMatchObject({ kind: 'api-token' });
      iam.stop();

      // A restricted Console account with default privileges for the main account (ADR 0059 §4):
      // the tables written back must not become readable by it (review L2).
      let role: { user: string; password: string; host?: string } | undefined;
      if (config.dialect === 'pg') {
        const admin = new ProjectDatabase(config);
        await admin.start();
        role = await provisionConsoleRole((sql, params) => admin.query(sql, params), { dialect: 'pg', projectKey: `revert-${root}` });
        own?.adoptRole(role.user);
        await admin.stop();
      }
      const revertConfig = role ? { ...config, console: { user: role.user, password: role.password } } : config;
      const reverted = await revertLegacyIamImport({ store, projectRoot: root, projectDatabase: async () => revertConfig });
      if (role) {
        expect(reverted.warnings.join('\n')).toMatch(/DROP ROLE/);
        // The marker written by the gateway is never readable by PUBLIC or the console account.
        const marked = new ProjectDatabase(revertConfig as ProjectDatabaseConfig);
        await marked.start();
        await marked.writeStoreMarker({ storeId: 'f'.repeat(32), migratedAt: 1 });
        expect(await marked.query(`SELECT has_table_privilege($1, 'public.zhin_gateway_store', 'SELECT') AS role_select,
          has_any_column_privilege($1, 'public.zhin_gateway_store', 'SELECT, UPDATE') AS role_columns`, [role.user])).toEqual([{ role_select: false, role_columns: false }]);
        await marked.deleteStoreMarker();
        await marked.stop();
        const restricted = new ProjectDatabase({ ...config, user: role.user, password: role.password } as ProjectDatabaseConfig);
        await restricted.start();
        await expect(restricted.query(`SELECT password_hash FROM ${IAM_TABLES.users}`)).rejects.toMatchObject({ code: '42501' });
        await restricted.stop();
        const admin = new ProjectDatabase(config);
        await admin.start();
        await admin.query(`DROP OWNED BY "${role.user}"`).catch(() => undefined);
        await admin.query(`DROP ROLE IF EXISTS "${role.user}"`).catch(() => undefined);
        await admin.stop();
      }
      expect(reverted.counts).toMatchObject({ [IAM_TABLES.users]: 1, [IAM_TABLES.sessions]: 1 });
      const back = new ProjectDatabase(config);
      defineConsoleIamTables(back);
      await back.start();
      const again = new ConsoleIamService({ database: back, projectRoot: root });
      await again.start({ timers: false });
      expect(await again.authenticate(session.token)).toMatchObject({ userId: owner.id });
      again.stop();
      await back.stop();
    } finally {
      await store.close();
    }
  });
});
