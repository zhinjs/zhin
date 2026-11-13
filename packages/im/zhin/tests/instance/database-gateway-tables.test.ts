import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabaseHost, normalizeDatabaseHostConfig } from '@zhin.js/core/runtime';
import { authorizeConsoleRpc, dispatchRuntimeConsoleRpc, pickRpcReply, type ConsolePrincipal } from '@zhin.js/host-http';
import { openGatewayStore, ProjectDatabase } from '@zhin.js/gateway/database';
import { defineConsoleIamTables, IAM_TABLES } from '@zhin.js/gateway/iam';

const viewer: ConsolePrincipal = Object.freeze({
  kind: 'user',
  userId: 'v1',
  username: 'viewer',
  displayName: 'Viewer',
  credentialId: 's1',
  roles: ['viewer'],
  grants: [{ scope: { kind: 'global' }, permissions: ['ops.database.read', 'ops.database.write'] }],
});

const HASH = 'scrypt$secret-password-hash';

/**
 * Tables an earlier version's gateway left in the shared SQLite file (before the import of ADR 0059
 * §3 ran): every instance path still refuses them (defense in depth).
 */
async function sharedDatabase() {
  const directory = await mkdtemp(join(tmpdir(), 'zhin-gateway-tables-'));
  const filename = join(directory, 'bot.db');
  const gateway = new ProjectDatabase({ dialect: 'sqlite', filename });
  defineConsoleIamTables(gateway as never);
  await gateway.start();
  await gateway.models.get(IAM_TABLES.users)!.insert({
    id: 'u1', username: 'alice', display_name: 'Alice', password_hash: HASH,
    disabled: 0, password_changed_at: 1, created_at: 1, updated_at: 1,
  });
  const instance = createDatabaseHost({ dialect: 'sqlite', filename });
  instance.define('notes', { id: { type: 'integer', primary: true }, text: { type: 'text' } });
  instance.define('console_conversations', { id: { type: 'text', primary: true } });
  await instance.start();
  return {
    directory,
    instance,
    async close() {
      await instance.stop();
      await gateway.stop();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

async function rpc(instance: ReturnType<typeof createDatabaseHost>, message: Record<string, unknown>) {
  const payloads = await dispatchRuntimeConsoleRpc({ requestId: 1, ...message }, { database: instance.console } as never);
  return pickRpcReply({ requestId: 1, ...message }, payloads)!;
}

describe('instance database paths never reach the gateway console_* tables', () => {
  it('a viewer with ops.database.read cannot list, read, write or drop console_users', async () => {
    const db = await sharedDatabase();
    try {
      expect(authorizeConsoleRpc(viewer, { type: 'db:select', table: IAM_TABLES.users }).allowed).toBe(true);
      const tables = await rpc(db.instance, { type: 'db:tables' });
      expect(JSON.stringify(tables.data)).not.toContain('console_users');
      expect((await rpc(db.instance, { type: 'db:info' })).data).toMatchObject({ tables: ['notes', 'console_conversations'] });
      for (const message of [
        { type: 'db:select', table: IAM_TABLES.users },
        { type: 'db:select', table: 'CONSOLE_USERS' },
        { type: 'db:insert', table: IAM_TABLES.sessions, row: { id: 'x' } },
        { type: 'db:update', table: IAM_TABLES.users, row: { password_hash: 'x' }, where: { id: 'u1' } },
        { type: 'db:delete', table: IAM_TABLES.audit, where: { id: 'x' } },
        { type: 'db:drop-table', table: IAM_TABLES.tokens },
        { type: 'db:kv:entries', table: IAM_TABLES.users },
      ]) {
        const reply = await rpc(db.instance, message);
        expect(reply.error).toMatch(/owned by the management gateway/);
        expect(JSON.stringify(reply)).not.toContain(HASH);
      }
      // Instance-owned tables keep working.
      expect((await rpc(db.instance, { type: 'db:select', table: 'notes' })).data).toMatchObject({ rows: [] });
    } finally { await db.close(); }
  });

  it('refuses gateway tables through define, models, transactions and the raw registry', async () => {
    const db = await sharedDatabase();
    try {
      const host = createDatabaseHost({ dialect: 'sqlite', filename: join(db.directory, 'bot.db') });
      expect(() => host.define(IAM_TABLES.users, { id: { type: 'text', primary: true } })).toThrow(/management gateway/);
      expect(db.instance.models.get(IAM_TABLES.users)).toBeUndefined();
      await expect(db.instance.transaction!(async transaction => transaction.model(IAM_TABLES.users)))
        .rejects.toThrow(/management gateway/);
      const raw = db.instance.getRawDatabase() as unknown as {
        query(sql: string): Promise<unknown>;
        model(name: string): unknown;
        select(name: string, fields: string[]): unknown;
        models: Map<string, unknown>;
      };
      await expect(Promise.resolve().then(() => raw.query('SELECT password_hash FROM console_users'))).rejects.toThrow(/management gateway/);
      await expect(Promise.resolve().then(() => raw.query('SELECT * FROM "Console_Sessions"'))).rejects.toThrow(/management gateway/);
      expect(() => raw.model(IAM_TABLES.users)).toThrow(/management gateway/);
      expect(() => raw.select(IAM_TABLES.tokens, ['token_hash'])).toThrow(/management gateway/);
      expect(raw.models.has('notes')).toBe(true);
      expect(await raw.query('SELECT id FROM notes')).toEqual([]);
    } finally { await db.close(); }
  });

  it('checks every string-like argument of every raw and transaction method, not only query', async () => {
    const db = await sharedDatabase();
    try {
      const raw = db.instance.getRawDatabase() as unknown as {
        query(sql: unknown, params?: unknown[]): Promise<unknown>;
        transaction<T>(callback: (trx: Record<string, (...args: unknown[]) => Promise<unknown>>) => Promise<T>): Promise<T>;
        select(name: string, fields: string[]): { where(condition: unknown): Promise<unknown> };
      };
      const refused = async (run: () => unknown) => {
        await expect(Promise.resolve().then(run)).rejects.toThrow(/management gateway/);
      };
      const marker = 'DELETE FROM console_users';
      await refused(() => raw.transaction(trx => trx.queryStatement!(marker)));
      await refused(() => raw.transaction(trx => trx.query!(marker)));
      await refused(() => raw.query(new String(marker)));
      await refused(() => raw.query({ toString: () => marker }));
      await refused(() => raw.query([marker]));
      await refused(() => raw.query('SELECT id FROM notes WHERE id IN (?)', [{ nested: [marker] }]));
      await refused(() => raw.select('notes', ['id']).where({ id: { $raw: '1) UNION SELECT password_hash FROM console_users --' } }));
      await refused(() => raw.transaction(trx => trx.query!(Object.assign(Object.create(null), { toString: () => marker }))));
      // A toString that answers differently the second time cannot slip through: the checked string
      // is what the driver gets.
      let calls = 0;
      await expect(raw.query({ toString: () => (calls++ === 0 ? 'SELECT id FROM notes' : marker) })).resolves.toEqual([]);
      expect(calls).toBe(1);
      // The gateway rows are intact.
      const check = new ProjectDatabase({ dialect: 'sqlite', filename: join(db.directory, 'bot.db') });
      defineConsoleIamTables(check as never);
      await check.start();
      try {
        expect(await check.models.get(IAM_TABLES.users)!.select('id')).toEqual([{ id: 'u1' }]);
      } finally { await check.stop(); }
      // Ordinary transaction statements keep working.
      await raw.transaction(trx => trx.query!('INSERT INTO notes (id, text) VALUES (?, ?)', [1, new String('hello')]));
      expect(await raw.query('SELECT id, text FROM notes')).toEqual([{ id: 1, text: 'hello' }]);
    } finally { await db.close(); }
  });
});

describe('a plugin on the SQLite instance database cannot open .zhin/gateway.db (ADR 0059 §2)', () => {
  it('refuses raw ATTACH, poisons a transaction that swallowed it, and has no gateway table view', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zhin-gateway-attach-'));
    const store = await openGatewayStore(directory);
    await store.models.get(IAM_TABLES.users)!.insert({
      id: 'u1', username: 'alice', display_name: 'Alice', password_hash: HASH,
      disabled: 0, password_changed_at: 1, created_at: 1, updated_at: 1,
    });
    // The instance resolves its database through the core config (denyAttach is forced on).
    const host = createDatabaseHost(normalizeDatabaseHostConfig({ dialect: 'sqlite', filename: join(directory, '.zhin', 'data.sqlite') }));
    host.define('notes', { id: { type: 'integer', primary: true }, text: { type: 'text' } });
    try {
      await host.start();
      expect('gatewayTableHost' in host).toBe(false);
      expect(host.models.get(IAM_TABLES.users)).toBeUndefined();
      const raw = host.getRawDatabase() as unknown as {
        query(sql: string): Promise<unknown>;
        transaction<T>(callback: (trx: { query(sql: string): Promise<unknown> }) => Promise<T>): Promise<T>;
      };
      const attach = `ATTACH DATABASE '${store.filename}' AS g`;
      await expect(raw.query(attach)).rejects.toThrow(/ATTACH DATABASE is not allowed/);
      // Even a table name the text guard does not know cannot be read through an attachment.
      await expect(raw.query('SELECT name FROM g.sqlite_master')).rejects.toThrow(/no such table/);
      let afterAttach: unknown;
      await expect(raw.transaction(async (trx) => {
        await trx.query("INSERT INTO notes (id, text) VALUES (1, 'x')");
        await trx.query(attach).catch(() => undefined);
        afterAttach = await trx.query('SELECT name FROM g.sqlite_master').catch((error: unknown) => error);
      })).rejects.toThrow(/ATTACH DATABASE is not allowed/);
      expect(String(afterAttach)).toMatch(/ATTACH DATABASE is not allowed/);
      expect(await raw.query('SELECT id FROM notes')).toEqual([]);
      expect(((await raw.query('PRAGMA database_list')) as Array<{ name: string }>).map(row => row.name)).toEqual(['main']);
    } finally {
      await host.stop();
      await store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
