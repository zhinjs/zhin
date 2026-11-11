import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabaseHost } from '@zhin.js/core/runtime';
import { authorizeConsoleRpc, dispatchRuntimeConsoleRpc, pickRpcReply, type ConsolePrincipal } from '@zhin.js/host-http';
import { ProjectDatabase } from '@zhin.js/gateway/database';
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

/** The gateway and the instance share one SQLite file; the gateway owns console_* (ADR 0054 §7). */
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
});

describe('standalone Console access control (no gateway)', () => {
  it('reaches console_* only through the root-only gateway table view', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zhin-gateway-view-'));
    const host = createDatabaseHost({ dialect: 'sqlite', filename: join(directory, 'bot.db') });
    try {
      const view = host.gatewayTableHost();
      defineConsoleIamTables(view);
      expect(() => view.define('notes', { id: { type: 'integer', primary: true } })).toThrow(/not a gateway table/);
      host.define('notes', { id: { type: 'integer', primary: true } });
      await host.start();
      expect(view.started).toBe(true);
      expect(view.tables()).toContain(IAM_TABLES.users);
      expect(view.models.get(IAM_TABLES.users)).toBeDefined();
      expect(view.models.get('notes')).toBeUndefined();
      // Every other surface of the same host still refuses them.
      expect(host.tables()).toEqual(['notes']);
      expect(host.models.get(IAM_TABLES.users)).toBeUndefined();
      expect((await rpc(host, { type: 'db:select', table: IAM_TABLES.users })).error).toMatch(/owned by the management gateway/);
      expect(JSON.stringify((await rpc(host, { type: 'db:tables' })).data)).not.toContain('console_');
    } finally { await host.stop(); await rm(directory, { recursive: true, force: true }); }
  });
});
