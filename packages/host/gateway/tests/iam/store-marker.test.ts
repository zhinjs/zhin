import { existsSync, readdirSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openGatewayStore, ProjectDatabase, type GatewayStore, type ProjectDatabaseConfig } from '../../src/database/index.js';
import { GatewayHttpServer } from '../../src/http/gateway-http-server.js';
import { startGatewayConsole } from '../../src/http/gateway-console.js';
import {
  importLegacyIamTables,
  inspectLegacyIamImport,
  isTransientLegacyImportError,
  LegacyImportError,
  readLegacyImportRecord,
  resetGatewayStore,
  revertLegacyIamImport,
  type LegacyIamSource,
} from '../../src/iam/legacy-import.js';
import { ConsoleIamService } from '../../src/iam/service.js';
import { defineConsoleIamTables, IAM_TABLES } from '../../src/iam/tables.js';

/**
 * ADR 0059 §3 修订 (review M2 / M3): the project database remembers which gateway.db holds the
 * Console accounts, so losing gateway.db never reopens setup; failures that need the operator are
 * not retried, transient ones back off, and a retried copy does not write another full backup.
 */
const PASSWORD = 'correct-horse-battery';
const dirs: string[] = [];
const closers: Array<() => Promise<unknown>> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close().catch(() => undefined);
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

async function project() {
  const root = await mkdtemp(join(tmpdir(), 'zhin-store-marker-'));
  dirs.push(root);
  const config: ProjectDatabaseConfig = { dialect: 'sqlite', filename: join(root, '.zhin', 'data.sqlite') };
  return { root, config };
}

async function open(root: string): Promise<GatewayStore> {
  const store = await openGatewayStore(root);
  closers.push(() => store.close());
  return store;
}

async function marker(config: ProjectDatabaseConfig) {
  const db = new ProjectDatabase(config);
  await db.start();
  try {
    return await db.readStoreMarker();
  } finally {
    await db.stop();
  }
}

async function seedLegacy(root: string, config: ProjectDatabaseConfig): Promise<void> {
  const legacy = new ProjectDatabase(config);
  defineConsoleIamTables(legacy);
  await legacy.start();
  const iam = new ConsoleIamService({ database: legacy, projectRoot: root });
  await iam.start({ timers: false });
  await iam.createOwner({ username: 'owner', password: PASSWORD });
  iam.stop();
  await legacy.stop();
}

async function createProjectFile(config: ProjectDatabaseConfig): Promise<void> {
  const db = new ProjectDatabase(config);
  db.define('notes', { id: { type: 'integer', primary: true } });
  await db.start();
  await db.stop();
}

describe('the store marker in the project database', () => {
  it('names the store after a migration and after a fresh start, and is written once the SQLite file exists', async () => {
    const migrated = await project();
    await seedLegacy(migrated.root, migrated.config);
    const store = await open(migrated.root);
    expect(store.storeId).toMatch(/^[0-9a-f]{32}$/);
    await importLegacyIamTables({ store, projectRoot: migrated.root, projectDatabase: async () => migrated.config });
    expect(await marker(migrated.config)).toMatchObject({ storeId: store.storeId });

    const fresh = await project();
    const freshStore = await open(fresh.root);
    // No project file yet (the instance starts after the gateway): it is created for the marker.
    await importLegacyIamTables({ store: freshStore, projectRoot: fresh.root, projectDatabase: async () => fresh.config });
    expect(existsSync(fresh.config.filename as string)).toBe(true);
    expect(await marker(fresh.config)).toMatchObject({ storeId: freshStore.storeId });
  });

  it('first run of a SQLite project, then gateway.db is lost: setup stays closed (review m2)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-store-marker-m2-'));
    dirs.push(root);
    const config: ProjectDatabaseConfig = { dialect: 'sqlite', filename: join(root, 'data', 'bot.db') };
    let store = await openGatewayStore(root);
    expect(await importLegacyIamTables({ store, projectRoot: root, projectDatabase: async () => config })).toMatchObject({ status: 'fresh' });
    // The owner is created; the instance starts and uses data/bot.db.
    const iam = new ConsoleIamService({ database: store, projectRoot: root });
    await iam.start({ timers: false });
    await iam.createOwner({ username: 'owner', password: PASSWORD });
    iam.stop();
    await createProjectFile(config);
    await store.close();
    expect(await marker(config)).toBeDefined();
    for (const suffix of ['', '-wal', '-shm']) await rm(join(root, '.zhin', `gateway.db${suffix}`), { force: true });
    store = await open(root);
    await expect(importLegacyIamTables({ store, projectRoot: root, projectDatabase: async () => config }))
      .rejects.toSatisfy((error: unknown) => error instanceof LegacyImportError && error.code === 'store_lost');
  });

  it('the gateway writes a missing marker after the first owner and when the instance first runs', async () => {
    const { root, config } = await project();
    const server = new GatewayHttpServer({ http: { host: '127.0.0.1', port: 0 }, instance: { transport: () => undefined, state: () => 'running' } });
    closers.push(() => server.close());
    const gateway = await startGatewayConsole({ server, projectRoot: root, database: config, retryMs: 60_000 } as never);
    closers.push(() => gateway.close());
    await gateway.ready;
    // Marker removed behind its back (e.g. the project file was recreated): the next owner / ready event restores it.
    const db = new ProjectDatabase(config);
    await db.start();
    await db.deleteStoreMarker();
    await db.stop();
    await gateway.iam()!.createOwner({ username: 'owner', password: PASSWORD });
    await expect.poll(() => marker(config)).toMatchObject({ storeId: gateway.database()!.storeId });
    const again = new ProjectDatabase(config);
    await again.start();
    await again.deleteStoreMarker();
    await again.stop();
    await gateway.ensureStoreMarker();
    expect(await marker(config)).toMatchObject({ storeId: gateway.database()!.storeId });
  });

  it('treats every driver error as transient; only its own refusals are permanent (review 5)', async () => {
    const { root, config } = await project();
    await seedLegacy(root, config);
    const store = await open(root);
    for (const error of [
      new Error('Connection terminated unexpectedly'),
      Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' }),
      Object.assign(new Error('sorry, too many clients already'), { code: '53300' }),
      Object.assign(new Error('could not serialize access'), { code: '40001' }),
      Object.assign(new Error('deadlock detected'), { code: '40P01' }),
      Object.assign(new Error('Lock wait timeout exceeded'), { code: 'ER_LOCK_WAIT_TIMEOUT', errno: 1205 }),
      Object.assign(new Error('connection closed'), { name: 'MongoNetworkError' }),
    ]) {
      const failing = (cfg: ProjectDatabaseConfig): LegacyIamSource => {
        const inner = new ProjectDatabase(cfg);
        return {
          dialect: cfg.dialect, start: () => inner.start(), stop: () => inner.stop(), dropTables: tables => inner.dropTables(tables),
          tableExists: names => inner.tableExists(names), readStoreMarker: () => inner.readStoreMarker(),
          readSnapshot: async () => { throw error; },
        };
      };
      const caught = await importLegacyIamTables({ store, projectRoot: root, projectDatabase: async () => config, openSource: failing }).catch((thrown: unknown) => thrown);
      expect(caught, error.message).toBeInstanceOf(LegacyImportError);
      expect((caught as LegacyImportError).code, error.message).toBe('unavailable');
      expect(isTransientLegacyImportError(caught), error.message).toBe(true);
    }
    expect(await store.getMeta('legacy_import_failure')).toBeUndefined();
  });

  it('refuses a lost gateway.db instead of reopening setup, until zhin console init --reset-store', async () => {
    const { root, config } = await project();
    await seedLegacy(root, config);
    const first = await openGatewayStore(root);
    await importLegacyIamTables({ store: first, projectRoot: root, projectDatabase: async () => config });
    const lostId = first.storeId;
    await first.close();
    // gateway.db is lost (container recreated without a volume).
    for (const suffix of ['', '-wal', '-shm']) await rm(join(root, '.zhin', `gateway.db${suffix}`), { force: true });
    const store = await open(root);
    expect(store.storeId).not.toBe(lostId);
    const lost = await importLegacyIamTables({ store, projectRoot: root, projectDatabase: async () => config }).catch((error: unknown) => error);
    expect(lost).toBeInstanceOf(LegacyImportError);
    expect((lost as LegacyImportError).code).toBe('store_lost');
    expect(isTransientLegacyImportError(lost)).toBe(false);
    expect((lost as Error).message).toContain(lostId);
    expect(await readLegacyImportRecord(store)).toBeUndefined();
    expect(await inspectLegacyIamImport({ store, projectRoot: root, projectDatabase: async () => config })).toMatchObject({ failure: { code: 'store_lost' } });

    // The operator accepts the loss.
    const reset = await resetGatewayStore({ store, projectRoot: root, projectDatabase: async () => config });
    expect(reset).toEqual({ previousStoreId: lostId, storeId: store.storeId });
    expect(await marker(config)).toMatchObject({ storeId: store.storeId });
    expect(await readLegacyImportRecord(store)).toMatchObject({ status: 'fresh', reason: 'reset-store' });
    const audit = await store.query<Array<{ actor: string; action: string; detail: string }>>(`SELECT actor, action, detail FROM ${IAM_TABLES.audit}`);
    expect(audit).toEqual([{ actor: 'local', action: 'auth.store.reset', detail: expect.stringContaining(lostId) }]);
    expect(await importLegacyIamTables({ store, projectRoot: root, projectDatabase: async () => config })).toMatchObject({ status: 'fresh' });
    expect(await inspectLegacyIamImport({ store, projectRoot: root, projectDatabase: async () => config })).not.toHaveProperty('failure');
  });

  it('refuses a settled store whose id the marker does not name (another project’s gateway.db)', async () => {
    const { root, config } = await project();
    await createProjectFile(config);
    const store = await open(root);
    await importLegacyIamTables({ store, projectRoot: root, projectDatabase: async () => config });
    const db = new ProjectDatabase(config);
    await db.start();
    await db.writeStoreMarker({ storeId: 'f'.repeat(32), migratedAt: 1 });
    await db.stop();
    await expect(importLegacyIamTables({ store, projectRoot: root, projectDatabase: async () => config }))
      .rejects.toSatisfy((error: unknown) => error instanceof LegacyImportError && error.code === 'store_mismatch');
  });

  it('is refused to the instance like the console_* tables, and removed by --revert', async () => {
    const { root, config } = await project();
    await seedLegacy(root, config);
    const store = await open(root);
    await importLegacyIamTables({ store, projectRoot: root, projectDatabase: async () => config });
    const { isGatewayOwnedTable, referencesGatewayOwnedTable } = await import('@zhin.js/database');
    expect(isGatewayOwnedTable('zhin_gateway_store')).toBe(true);
    expect(referencesGatewayOwnedTable('DROP TABLE "zhin_gateway_store"')).toBe(true);
    const reverted = await revertLegacyIamImport({ store, projectRoot: root, projectDatabase: async () => config });
    expect(reverted.warnings).toEqual([]);
    expect(await marker(config)).toBeUndefined();
  });
});

describe('retries (review M3)', () => {
  it('writes one backup per distinct legacy snapshot, however often the copy fails', async () => {
    const { root, config } = await project();
    await seedLegacy(root, config);
    const store = await open(root);
    const withoutIds = (cfg: ProjectDatabaseConfig): LegacyIamSource => {
      const inner = new ProjectDatabase(cfg);
      return {
        dialect: cfg.dialect,
        start: () => inner.start(), stop: () => inner.stop(), tableExists: names => inner.tableExists(names), dropTables: tables => inner.dropTables(tables),
        readStoreMarker: () => inner.readStoreMarker(), writeStoreMarker: value => inner.writeStoreMarker(value),
        readSnapshot: async tables => Object.fromEntries(Object.entries(await inner.readSnapshot(tables)).map(([table, rows]) => [table, rows.map(({ id: _id, ...row }) => row)])),
      };
    };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(importLegacyIamTables({ store, projectRoot: root, projectDatabase: async () => config, openSource: withoutIds }))
        .rejects.toSatisfy((error: unknown) => error instanceof LegacyImportError && error.code === 'invalid');
    }
    expect(readdirSync(join(root, '.zhin', 'backups'))).toHaveLength(1);
    // The real rows (with ids) are a different snapshot: one more backup, then done.
    await importLegacyIamTables({ store, projectRoot: root, projectDatabase: async () => config });
    expect(readdirSync(join(root, '.zhin', 'backups'))).toHaveLength(2);
  });

  it('the gateway backs off on transient failures and does not retry ones that need the operator', async () => {
    const transient = await project();
    await mkdir(join(transient.root, 'busy.sqlite'), { recursive: true });
    let attempts = 0;
    const server = new GatewayHttpServer({ http: { host: '127.0.0.1', port: 0 }, instance: { transport: () => undefined, state: () => 'running' } });
    closers.push(() => server.close());
    const unreachable: ProjectDatabaseConfig = { dialect: 'sqlite', filename: join(transient.root, 'busy.sqlite') };
    const backingOff = await startGatewayConsole({
      server, projectRoot: transient.root, retryMs: 20,
      get database() { attempts += 1; return unreachable; },
    } as never);
    closers.push(() => backingOff.close());
    await backingOff.ready;
    await new Promise(resolve => setTimeout(resolve, 700));
    // 20, 40, 80, 160, 320 ms … — without backoff it would be ~35 attempts.
    expect(attempts).toBeGreaterThanOrEqual(3);
    expect(attempts).toBeLessThanOrEqual(7);

    const lost = await project();
    await createProjectFile(lost.config);
    const db = new ProjectDatabase(lost.config);
    await db.start();
    await db.writeStoreMarker({ storeId: 'e'.repeat(32), migratedAt: 1 });
    await db.stop();
    let lostAttempts = 0;
    const server2 = new GatewayHttpServer({ http: { host: '127.0.0.1', port: 0 }, instance: { transport: () => undefined, state: () => 'running' } });
    closers.push(() => server2.close());
    const closed = await startGatewayConsole({
      server: server2, projectRoot: lost.root, retryMs: 20,
      get database() { lostAttempts += 1; return lost.config; },
    } as never);
    closers.push(() => closed.close());
    await closed.ready;
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(lostAttempts).toBe(1);
    expect(closed.iam()?.initialized()).toBe(true);
    expect(closed.iam()?.publicUnavailable()).toMatchObject({ code: 'store_lost' });
  });

  it('closes the Console when a later marker check finds another store id (same state as at connect)', async () => {
    const { root, config } = await project();
    await createProjectFile(config);
    const server = new GatewayHttpServer({ http: { host: '127.0.0.1', port: 0 }, instance: { transport: () => undefined, state: () => 'running' } });
    closers.push(() => server.close());
    let attempts = 0;
    const revoked: Array<{ principalId: string; reason?: string }> = [];
    const gateway = await startGatewayConsole({
      server, projectRoot: root, retryMs: 20,
      get database() { attempts += 1; return config; },
      instance: { revokePrincipal: (principalId: string, reason?: string) => { revoked.push({ principalId, ...(reason ? { reason } : {}) }); } },
    } as never);
    closers.push(() => gateway.close());
    await gateway.ready;
    expect(gateway.iam()?.publicUnavailable()).toBeUndefined();
    const owner = await gateway.iam()!.createOwner({ username: 'owner', password: PASSWORD });
    const session = await gateway.iam()!.login('owner', PASSWORD);
    expect(await gateway.iam()!.authenticate(session.token, {})).not.toBeNull();
    await gateway.ensureStoreMarker();
    const own = await marker(config);
    expect(own?.storeId).toMatch(/^[0-9a-f]{32}$/);
    // Another gateway.db took the project database over meanwhile.
    const db = new ProjectDatabase(config);
    await db.start();
    await db.writeStoreMarker({ storeId: 'd'.repeat(32), migratedAt: 1 });
    await db.stop();
    await gateway.ensureStoreMarker();
    expect(gateway.iam()?.initialized()).toBe(true);
    expect(gateway.iam()?.publicUnavailable()).toMatchObject({ code: 'store_mismatch' });
    expect(await gateway.localAdmin.handle('gateway.console.migration.status', {})).toMatchObject({ ok: true, data: { pendingCode: 'store_mismatch' } });
    // Open sessions end: the token no longer authenticates and the instance drops the user.
    expect(await gateway.iam()!.authenticate(session.token, {})).toBeNull();
    expect(revoked).toContainEqual({ principalId: (owner as { id: string }).id, reason: 'store_mismatch' });
    // Not retried: it needs the operator.
    const before = attempts;
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(attempts).toBe(before);
    expect(gateway.iam()?.publicUnavailable()).toMatchObject({ code: 'store_mismatch' });
  });
});
