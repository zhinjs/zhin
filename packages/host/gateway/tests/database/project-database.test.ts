import { existsSync, statSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  GATEWAY_STORE_SCHEMA_VERSION,
  loadProjectDatabaseConfig,
  openGatewayStore,
  ProjectDatabase,
  resolveProjectDatabaseConfig,
  SNAPSHOT_BATCH_SIZE,
} from '../../src/database/index.js';
import { ConsoleIamService } from '../../src/iam/service.js';
import { defineConsoleIamTables, IAM_TABLES } from '../../src/iam/tables.js';

const dirs: string[] = [];
const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close().catch(() => undefined);
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function project(config?: string, env?: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'zhin-gateway-db-'));
  dirs.push(dir);
  if (config !== undefined) await writeFile(join(dir, 'zhin.config.yml'), config);
  if (env !== undefined) await writeFile(join(dir, '.env'), env);
  return dir;
}

describe('project database config (gateway port of resolveDatabaseConfig)', () => {
  it('defaults to .zhin/data.sqlite under the project root', async () => {
    const root = await project('configVersion: 2\nplugins: {}\n');
    expect(await loadProjectDatabaseConfig(root)).toEqual({ dialect: 'sqlite', filename: join(root, '.zhin', 'data.sqlite') });
  });

  it('expands .env placeholders and anchors relative sqlite files at the project root', async () => {
    const root = await project('database:\n  dialect: sqlite\n  filename: ${DB_FILE}\n', 'DB_FILE=./data/bot.db\n');
    expect(await loadProjectDatabaseConfig(root)).toEqual({ dialect: 'sqlite', filename: join(root, 'data', 'bot.db') });
    expect(await resolveProjectDatabaseConfig(root, { database: { dialect: 'sqlite' } }))
      .toEqual({ dialect: 'sqlite', filename: join(root, 'data', 'bot.db') });
  });

  it('validates network drivers like the instance does', async () => {
    const root = await project();
    await expect(resolveProjectDatabaseConfig(root, { database: { dialect: 'mysql', port: 'abc' } })).rejects.toThrow(/database\.port/u);
    await expect(resolveProjectDatabaseConfig(root, { database: { dialect: 'oracle' } })).rejects.toThrow(/不支持/u);
    expect(await resolveProjectDatabaseConfig(root, { database: { dialect: 'pg', port: '5433', host: ' db ' } }))
      .toEqual({ dialect: 'pg', port: 5433, host: 'db' });
  });
});

describe('the gateway store .zhin/gateway.db (ADR 0059 §1)', () => {
  it('is an owner-only WAL file of its own; the project database file is never created for it', async () => {
    const root = await project();
    const store = await openGatewayStore(root);
    closers.push(() => store.close());
    expect(store.filename).toBe(join(root, '.zhin', 'gateway.db'));
    const iam = new ConsoleIamService({ database: store, projectRoot: root });
    await iam.start({ timers: false });
    closers.push(async () => { iam.stop(); });
    const owner = await iam.createOwner({ username: 'owner', password: 'correct-horse-battery' });
    const login = await iam.login('owner', 'correct-horse-battery');
    expect(await iam.authenticate(login.token)).toMatchObject({ kind: 'user', userId: owner.id });
    expect(await store.query('PRAGMA journal_mode')).toEqual([{ journal_mode: 'wal' }]);
    expect(await store.getMeta('schema_version')).toBe(GATEWAY_STORE_SCHEMA_VERSION);
    expect(await store.counts()).toMatchObject({ [IAM_TABLES.users]: 1, [IAM_TABLES.sessions]: 1 });
    if (process.platform !== 'win32') {
      for (const suffix of ['', '-wal', '-shm']) {
        expect(statSync(`${store.filename}${suffix}`).mode & 0o777, suffix || 'db').toBe(0o600);
      }
    }
    expect(existsSync(join(root, '.zhin', 'data.sqlite'))).toBe(false);
  });

  it('closes the open Host as soon as `zhin console init` creates the owner beside a running gateway', async () => {
    const root = await project();
    const gateway = await openGatewayStore(root);
    closers.push(() => gateway.close());
    // The running gateway: periodic refresh only every 30 s (timers off here).
    const running = new ConsoleIamService({ database: gateway, projectRoot: root });
    await running.start({ timers: false });
    closers.push(async () => { running.stop(); });
    expect(running.initialized()).toBe(false);

    // `zhin console init`: another connection (another process in production).
    const cli = await openGatewayStore(root);
    closers.push(() => cli.close());
    const init = new ConsoleIamService({ database: cli, projectRoot: root });
    await init.start({ timers: false });
    await init.createOwner({ username: 'owner', password: 'correct-horse-battery' });
    init.stop();

    // Fails closed on the setup marker right away, then confirms from the database.
    expect(running.initialized()).toBe(true);
    await expect.poll(() => running.refreshOwnerState()).toBe(true);
    expect(running.initialized()).toBe(true);
  });

  it('fails closed while access control is unavailable: no bootstrap, no sessions', async () => {
    const root = await project();
    const store = await openGatewayStore(root);
    closers.push(() => store.close());
    let reason: string | undefined = 'importing';
    const iam = new ConsoleIamService({ database: store, projectRoot: root, unavailable: () => reason });
    await iam.start({ timers: false });
    closers.push(async () => { iam.stop(); });
    // An empty store is never "no owner yet" while unavailable.
    expect(iam.initialized()).toBe(true);
    expect(iam.ready).toBe(false);
    expect(iam.unavailableReason()).toBe('importing');
    reason = undefined;
    expect(iam.initialized()).toBe(false);
    const owner = await iam.createOwner({ username: 'owner', password: 'correct-horse-battery' });
    const login = await iam.login('owner', 'correct-horse-battery');
    reason = 'reconnecting';
    expect(await iam.authenticate(login.token)).toBeNull();
    reason = undefined;
    expect(await iam.authenticate(login.token)).toMatchObject({ userId: owner.id });
  });
});

describe('project database config: database.console (ADR 0059 §4)', () => {
  it('keeps the restricted account of PostgreSQL / MySQL, drops it elsewhere and keeps it from the driver', async () => {
    const root = await project();
    expect(await resolveProjectDatabaseConfig(root, { database: { dialect: 'pg', user: 'zhin', console: { user: 'zhin_console_x', password: 'p' } } }))
      .toEqual({ dialect: 'pg', user: 'zhin', console: { user: 'zhin_console_x', password: 'p' } });
    expect(await resolveProjectDatabaseConfig(root, { database: { dialect: 'pg', console: { user: '', password: '' } } })).toEqual({ dialect: 'pg' });
    await expect(resolveProjectDatabaseConfig(root, { database: { dialect: 'mysql', user: 'zhin', console: { user: 'zhin', password: 'p' } } })).rejects.toThrow(/database\.console\.user/u);
    await expect(resolveProjectDatabaseConfig(root, { database: { dialect: 'pg', console: { user: 'r', password: '' } } })).rejects.toThrow(/database\.console\.password/u);
    await expect(resolveProjectDatabaseConfig(root, { database: { dialect: 'pg', console: { user: 'r', password: 'p', host: 'x' } } })).rejects.toThrow(/database\.console\.host/u);
    expect(await resolveProjectDatabaseConfig(root, { database: { dialect: 'sqlite', filename: 'a.db', console: { user: 'r', password: 'p' }, denyAttach: false } }))
      .toEqual({ dialect: 'sqlite', filename: join(root, 'a.db') });
  });
});

describe('project database snapshots (legacy import, ADR 0059 §3)', () => {
  it('lists existing tables from the catalog, reads them in id batches and drops them', async () => {
    const root = await project();
    const filename = join(root, 'legacy.sqlite');
    const seed = new ProjectDatabase({ dialect: 'sqlite', filename });
    defineConsoleIamTables(seed);
    await seed.start();
    for (let index = 0; index < SNAPSHOT_BATCH_SIZE + 3; index += 1) {
      await seed.query(`INSERT INTO ${IAM_TABLES.audit} (id, at, actor, action, outcome) VALUES (?, ?, 'a', 'b', 'ok')`, [`a${String(index).padStart(4, '0')}`, index]);
    }
    await seed.stop();
    const source = new ProjectDatabase({ dialect: 'sqlite', filename });
    await source.start();
    closers.push(() => source.stop());
    expect(source.tables()).toEqual([]);
    expect(await source.tableExists([IAM_TABLES.audit, 'nope', IAM_TABLES.users])).toEqual([IAM_TABLES.audit, IAM_TABLES.users]);
    const rows = await source.readSnapshot([IAM_TABLES.audit, IAM_TABLES.users]);
    expect(rows[IAM_TABLES.audit]).toHaveLength(SNAPSHOT_BATCH_SIZE + 3);
    expect(rows[IAM_TABLES.audit]![SNAPSHOT_BATCH_SIZE + 2]).toMatchObject({ id: `a${String(SNAPSHOT_BATCH_SIZE + 2).padStart(4, '0')}` });
    expect(rows[IAM_TABLES.users]).toEqual([]);
    await source.dropTables([IAM_TABLES.audit, IAM_TABLES.users, 'nope']);
    expect(await source.tableExists([IAM_TABLES.audit, IAM_TABLES.users])).toEqual([]);
  });
});
