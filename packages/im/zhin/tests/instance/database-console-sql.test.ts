import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabaseHost } from '@zhin.js/core/runtime';
import { dispatchRuntimeConsoleRpc, pickRpcReply, rpcAuditDetail } from '@zhin.js/host-http';
import { ProjectDatabase } from '@zhin.js/gateway/database';
import { defineConsoleIamTables, IAM_TABLES } from '@zhin.js/gateway/iam';

const HASH = 'scrypt$secret-password-hash';

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'zhin-db-console-sql-'));
  const filename = join(directory, 'bot.db');
  const gateway = new ProjectDatabase({ dialect: 'sqlite', filename });
  defineConsoleIamTables(gateway as never);
  await gateway.start();
  await gateway.models.get(IAM_TABLES.users)!.insert({
    id: 'u1', username: 'alice', display_name: 'Alice', password_hash: HASH,
    disabled: 0, password_changed_at: 1, created_at: 1, updated_at: 1,
  });
  let instance = createDatabaseHost({ dialect: 'sqlite', filename });
  instance.define('notes', { id: { type: 'integer', primary: true }, title: { type: 'text' }, score: { type: 'integer', nullable: true } });
  await instance.start();
  const notes = instance.models.get('notes')!;
  for (const [id, title, score] of [[1, 'b', 3], [2, 'a', null], [3, 'c', 1]] as const) await notes.insert({ id, title, score });
  const rpc = async (message: Record<string, unknown>) => {
    const request = { requestId: 1, ...message };
    return pickRpcReply(request, await dispatchRuntimeConsoleRpc(request, { database: instance.console } as never))!;
  };
  return {
    filename,
    get instance() { return instance; },
    rpc,
    async restart() {
      await instance.stop();
      instance = createDatabaseHost({ dialect: 'sqlite', filename });
      instance.define('notes', { id: { type: 'integer', primary: true }, title: { type: 'text' }, score: { type: 'integer', nullable: true } });
      await instance.start();
    },
    async close() {
      await instance.stop();
      await gateway.stop();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

describe('Console database: server-side sort and filter', () => {
  it('orders the whole table and validates columns and operators', async () => {
    const db = await setup();
    try {
      expect(db.instance.console!.info().capabilities).toMatchObject({ sort: true, sql: true, schema: true });
      const sorted = await db.rpc({ type: 'db:select', table: 'notes', page: 1, pageSize: 2, orderBy: { column: 'title', direction: 'desc' } });
      expect(sorted.data).toMatchObject({ total: 3, orderBy: { column: 'title', direction: 'desc' } });
      expect((sorted.data as { rows: { title: string }[] }).rows.map(row => row.title)).toEqual(['c', 'b']);
      const page2 = await db.rpc({ type: 'db:select', table: 'notes', page: 2, pageSize: 2, orderBy: { column: 'title', direction: 'desc' } });
      expect((page2.data as { rows: { title: string }[] }).rows.map(row => row.title)).toEqual(['a']);

      const filtered = await db.rpc({ type: 'db:select', table: 'notes', where: { score: { $gt: 1 } } });
      expect(filtered.data).toMatchObject({ total: 1, rows: [{ id: 1 }] });
      expect((await db.rpc({ type: 'db:select', table: 'notes', where: { score: { $eq: null } } })).data).toMatchObject({ total: 1, rows: [{ id: 2 }] });
      expect((await db.rpc({ type: 'db:select', table: 'notes', where: { score: { $ne: null } } })).data).toMatchObject({ total: 2 });

      for (const message of [
        { orderBy: { column: 'nope', direction: 'asc' } },
        { orderBy: { column: 'title', direction: 'sideways' } },
        { where: { 'id" IN (SELECT password_hash FROM console_users) OR "a': 1 } },
        { where: { title: { $regex: 'x' } } },
        { where: { title: { $eq: { nested: true } } } },
      ]) {
        const reply = await db.rpc({ type: 'db:select', table: 'notes', ...message });
        expect(reply.error).toBeTruthy();
        expect(JSON.stringify(reply)).not.toContain(HASH);
      }
    } finally { await db.close(); }
  });
});

describe('Console database: read-only SQL', () => {
  it('runs one read statement on an isolated read-only connection and caps the rows', async () => {
    const db = await setup();
    try {
      const transaction = vi.spyOn(db.instance.db as unknown as { transaction: (...args: unknown[]) => unknown }, 'transaction');
      const reply = await db.rpc({ type: 'db:query', sql: 'SELECT id, title FROM notes ORDER BY id' });
      expect(reply.data).toMatchObject({ columns: ['id', 'title'], rowCount: 3, truncated: false, rows: [{ id: 1, title: 'b' }, { id: 2 }, { id: 3 }] });
      expect(typeof (reply.data as { durationMs: unknown }).durationMs).toBe('number');
      // SQLite file databases read in a child process on their own read-only connection, off the event loop.
      expect(transaction).not.toHaveBeenCalled();

      const many = await db.rpc({ type: 'db:query', sql: 'WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 1500) SELECT x FROM n' });
      expect(many.data).toMatchObject({ rowCount: 1000, truncated: true });
      expect((many.data as { rows: unknown[] }).rows).toHaveLength(1000);
      expect((await db.rpc({ type: 'db:query', sql: 'SELECT x FROM (SELECT 1 AS x UNION ALL SELECT 2)' })).data).toMatchObject({ rowCount: 2, truncated: false });

      expect((await db.rpc({ type: 'db:query', sql: 'PRAGMA table_info(notes)' })).data).toMatchObject({ rowCount: 3 });
      // Migration bookkeeping and engine catalogs stay readable.
      expect((await db.rpc({ type: 'db:query', sql: 'SELECT name FROM sqlite_master WHERE type = \'table\' AND name = \'notes\'' })).data)
        .toMatchObject({ rows: [{ name: 'notes' }] });
    } finally { await db.close(); }
  });

  it('stops a long read at the time budget while the event loop keeps running', async () => {
    const db = await setup();
    try {
      let ticks = 0;
      const interval = setInterval(() => { ticks += 1; }, 20);
      const started = Date.now();
      const slow = 'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 20000000) SELECT count(*) AS n FROM c';
      const timed = await db.instance.console!.query!(slow, { timeoutMs: 300 }).then(() => undefined, (error: Error) => error);
      clearInterval(interval);
      expect(timed?.message).toMatch(/time limit/);
      expect(Date.now() - started).toBeLessThan(3000);
      expect(ticks).toBeGreaterThan(5);
      // The stopped read's process is killed inside its step: the next read works within a second.
      const recovered = Date.now();
      const next = await db.rpc({ type: 'db:query', sql: 'SELECT 1 AS one' });
      expect(next.data).toMatchObject({ rows: [{ one: 1 }] });
      expect(Date.now() - recovered).toBeLessThan(1500);
      // Stopping the host does not wait for (or leave behind) a running read.
      const pending = db.instance.console!.query!(slow, { timeoutMs: 30_000 }).catch((error: Error) => error);
      await new Promise(resolve => setTimeout(resolve, 200));
      const stopping = Date.now();
      await db.instance.stop();
      expect(Date.now() - stopping).toBeLessThan(1000);
      expect(await pending).toBeInstanceOf(Error);
    } finally { await db.close(); }
  }, 60_000);

  it('refuses raw SQL on an in-memory database (a query there could not be stopped)', async () => {
    const host = createDatabaseHost({ dialect: 'sqlite', filename: ':memory:' });
    host.define('notes', { id: { type: 'integer', primary: true } });
    await host.start();
    try {
      expect(host.console!.info().capabilities).toMatchObject({ sql: false, schema: true, reason: expect.stringContaining('in-memory') });
      await expect(host.console!.query!('WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n) SELECT x FROM n')).rejects.toMatchObject({ code: 'unsupported' });
      await expect(host.console!.execute!('DELETE FROM notes')).rejects.toMatchObject({ code: 'unsupported' });
    } finally { await host.stop(); }
  });

  it('refuses writes, several statements, setting pragmas and the gateway tables', async () => {
    const db = await setup();
    try {
      for (const [sql, code] of [
        ['INSERT INTO notes (id, title) VALUES (9, \'x\')', 'read_only'],
        ['UPDATE notes SET title = \'x\'', 'read_only'],
        ['SELECT 1; DELETE FROM notes', 'multi_statement'],
        ['WITH gone AS (SELECT 1) DELETE FROM notes', 'read_only'],
        ['PRAGMA query_only = 0', 'read_only'],
        ['PRAGMA query_only(0)', 'read_only'],
        ['SELECT * FROM console_users', 'protected_table'],
        ['SELECT * FROM "CONSOLE_USERS"', 'protected_table'],
        ['SELECT * FROM pragma_table_info(\'console_users\')', 'protected_table'],
        ['SELECT 1 /* ; */ ; ', undefined],
      ] as const) {
        const reply = await db.rpc({ type: 'db:query', sql });
        if (code === undefined) { expect(reply.error).toBeUndefined(); continue; }
        expect(reply.error, sql).toBeTruthy();
        expect(reply.data, sql).toEqual({ code });
        expect(JSON.stringify(reply)).not.toContain(HASH);
      }
      expect((await db.rpc({ type: 'db:select', table: 'notes' })).data).toMatchObject({ total: 3 });
    } finally { await db.close(); }
  });

  it('enforces read-only at the database even when a statement slips past the classifier', async () => {
    const db = await setup();
    try {
      const sqlite = db.instance.db as unknown as { transaction(callback: (trx: { query(sql: string): Promise<unknown> }) => Promise<unknown>, options?: { readOnly?: boolean }): Promise<unknown> };
      await expect(sqlite.transaction(trx => trx.query('DELETE FROM notes'), { readOnly: true })).rejects.toThrow(/readonly|read-only|query_only/i);
      expect((await db.rpc({ type: 'db:select', table: 'notes' })).data).toMatchObject({ total: 3 });
    } finally { await db.close(); }
  });
});

describe('Console database: write SQL', () => {
  it('estimates affected rows in a rolled-back dry run, then applies', async () => {
    const db = await setup();
    try {
      const dry = await db.rpc({ type: 'db:execute', sql: 'UPDATE notes SET title = \'z\' WHERE id < 3', dryRun: true });
      expect(dry.data).toMatchObject({ dryRun: true, statements: [{ affected: 2 }] });
      expect((await db.rpc({ type: 'db:select', table: 'notes', where: { title: 'z' } })).data).toMatchObject({ total: 0 });
      const real = await db.rpc({ type: 'db:execute', sql: 'UPDATE notes SET title = \'z\' WHERE id < 3; DELETE FROM notes WHERE id = 3' });
      expect(real.data).toMatchObject({ dryRun: false, statements: [{ affected: 2 }, { affected: 1 }] });
      expect((await db.rpc({ type: 'db:select', table: 'notes' })).data).toMatchObject({ total: 2 });
    } finally { await db.close(); }
  });

  it('runs a batch atomically: a failing statement rolls the batch back', async () => {
    const db = await setup();
    try {
      const reply = await db.rpc({ type: 'db:execute', sql: 'DELETE FROM notes; INSERT INTO missing_table VALUES (1)' });
      expect(reply.error).toMatch(/missing_table/);
      expect((await db.rpc({ type: 'db:select', table: 'notes' })).data).toMatchObject({ total: 3 });
    } finally { await db.close(); }
  });

  it('refuses protected tables and transaction / engine control statements', async () => {
    const db = await setup();
    try {
      for (const [sql, code] of [
        ['DELETE FROM console_users', 'protected_table'],
        ['UPDATE "console_sessions" SET id = 1', 'protected_table'],
        ['DROP TABLE __zhin_persistent_state', 'protected_table'],
        ['DELETE FROM _migrations', 'protected_table'],
        ['UPDATE sqlite_master SET sql = \'\'', 'protected_table'],
        ['BEGIN; DELETE FROM notes; COMMIT', 'refused_statement'],
        ['ATTACH DATABASE \'x.db\' AS x', 'refused_statement'],
        ['PRAGMA writable_schema = 1', 'refused_statement'],
        ['VACUUM', 'refused_statement'],
      ] as const) {
        const reply = await db.rpc({ type: 'db:execute', sql });
        expect(reply.error, sql).toBeTruthy();
        expect(reply.data, sql).toEqual({ code });
      }
      expect((await db.rpc({ type: 'db:select', table: 'notes' })).data).toMatchObject({ total: 3 });
    } finally { await db.close(); }
  });

  it('records the statement text with literals redacted, never result rows, in the audit detail', async () => {
    const host = createDatabaseHost({ dialect: 'pg' } as never);
    const audit = { redactSql: host.console!.redactSql! };
    expect(rpcAuditDetail({ type: 'db:execute', sql: 'DELETE FROM notes WHERE id = 1' }, undefined, audit))
      .toMatchObject({ type: 'db:execute', statements: ['DELETE FROM notes WHERE id = 1'] });
    expect(rpcAuditDetail({ type: 'db:execute', sql: 'DELETE FROM notes', dryRun: true }, undefined, audit)).toMatchObject({ dryRun: true });
    const applied = rpcAuditDetail(
      { type: 'db:schema:apply', change: { kind: 'drop-column', table: 'notes', column: 'score' }, confirm: 'score' },
      { success: true, data: { statements: ['ALTER TABLE "notes" DROP COLUMN "score"'], rows: [{ secret: 1 }] } },
      audit,
    );
    expect(applied).toMatchObject({ change: 'drop-column', table: 'notes', statements: ['ALTER TABLE "notes" DROP COLUMN "score"'] });
    expect(JSON.stringify(applied)).not.toContain('secret');
    // Literal values may be passwords or tokens: only their shape is kept.
    const secret = rpcAuditDetail({ type: 'db:execute', sql: "UPDATE \"users\" SET api_key = 'sk-live-123', note = E'it\\'s $x$' WHERE note = $q$hidden$q$" }, undefined, audit);
    expect(secret).toMatchObject({ statements: ["UPDATE \"users\" SET api_key = '…', note = E'…' WHERE note = $q$…$q$"] });
    expect(JSON.stringify(secret)).not.toMatch(/sk-live|hidden|it\\/);
    // Without the Host's lexer no statement text is recorded at all.
    expect(rpcAuditDetail({ type: 'db:execute', sql: "SELECT 'sk-live-123'" })).toMatchObject({ statementLength: 20 });
    expect(JSON.stringify(rpcAuditDetail({ type: 'db:execute', sql: "SELECT 'sk-live-123'" }))).not.toContain('sk-live');
    // The detail stays parseable once the gateway stores it, whatever the statement contains.
    for (const sql of [`SELECT '${'x'.repeat(10_000)}'`, `DELETE FROM notes WHERE 1=0${'\n'.repeat(2500)}AND 1=1`, `SELECT "${'\\"'.repeat(3000)}"`]) {
      const detail = rpcAuditDetail({ type: 'db:execute', sql }, undefined, audit);
      const stored = JSON.stringify(detail);
      expect(stored.length).toBeLessThanOrEqual(3500);
      expect(JSON.parse(stored)).toMatchObject({ type: 'db:execute' });
    }
    expect(rpcAuditDetail({ type: 'db:execute', sql: `DELETE FROM notes WHERE 1=0${'\n'.repeat(2500)}AND 1=1` }, undefined, audit)).toMatchObject({ truncated: true });
    expect(rpcAuditDetail({ type: 'db:select', table: 'notes' })).not.toHaveProperty('statements');
  });

  it('records the DDL a failed schema change attempted', async () => {
    const db = await setup();
    try {
      const reply = await db.rpc({ type: 'db:schema:apply', change: { kind: 'create-index', table: 'notes', name: 'by_title', columns: ['title'] } });
      expect(reply.error).toBeUndefined();
      const again = await db.rpc({ type: 'db:schema:apply', change: { kind: 'drop-index', table: 'notes', name: 'by_title' } });
      expect(again.data).toEqual({ code: 'confirm_required', statements: ['DROP INDEX "by_title"'] });
      const detail = rpcAuditDetail({ type: 'db:schema:apply', change: { kind: 'drop-index', table: 'notes', name: 'by_title' } }, again as never, { redactSql: db.instance.console!.redactSql! });
      expect(detail).toMatchObject({ change: 'drop-index', statements: ['DROP INDEX "by_title"'] });
    } finally { await db.close(); }
  });
});

describe('Console database: schema editor', () => {
  it('previews DDL, applies column changes and keeps the declared definition in step', async () => {
    const db = await setup();
    try {
      const preview = await db.rpc({ type: 'db:schema:preview', change: { kind: 'add-column', table: 'notes', column: { name: 'tag', type: 'text', nullable: true } } });
      expect(preview.data).toMatchObject({ statements: ['ALTER TABLE "notes" ADD COLUMN "tag" TEXT'], destructive: false });
      expect((await db.rpc({ type: 'db:schema:describe', table: 'notes' })).data).not.toMatchObject({ columns: expect.arrayContaining([expect.objectContaining({ name: 'tag' })]) });

      await db.rpc({ type: 'db:schema:apply', change: { kind: 'add-column', table: 'notes', column: { name: 'tag', type: 'text', nullable: true } } });
      expect(db.instance.console!.tables().find(table => table.name === 'notes')!.columns).toHaveProperty('tag');
      // Columns of a code-declared table cannot be renamed or dropped: the plugin reads them.
      for (const change of [
        { kind: 'rename-column', table: 'notes', column: 'tag', to: 'label' },
        { kind: 'drop-column', table: 'notes', column: 'score' },
      ]) {
        const refused = await db.rpc({ type: 'db:schema:preview', change });
        expect(refused.data, change.kind).toEqual({ code: 'unsupported' });
        expect(refused.error).toMatch(/declared by plugin code/);
      }

      await db.rpc({ type: 'db:schema:apply', change: { kind: 'create-table', table: 'scratch', columns: [{ name: 'id', type: 'integer', primary: true }, { name: 'tag', type: 'text' }, { name: 'extra', type: 'text' }] } });
      await db.rpc({ type: 'db:schema:apply', change: { kind: 'rename-column', table: 'scratch', column: 'tag', to: 'label' } });
      const described = await db.rpc({ type: 'db:schema:describe', table: 'scratch' });
      expect((described.data as { columns: { name: string }[] }).columns.map(column => column.name)).toEqual(['id', 'label', 'extra']);
      expect(db.instance.console!.tables().find(table => table.name === 'scratch')!.columns).toHaveProperty('label');

      const drop = { kind: 'drop-column', table: 'scratch', column: 'label' };
      expect((await db.rpc({ type: 'db:schema:preview', change: drop })).data).toMatchObject({ destructive: true, confirm: 'label', warnings: ['data_loss'] });
      expect((await db.rpc({ type: 'db:schema:apply', change: drop })).data).toMatchObject({ code: 'confirm_required' });
      expect((await db.rpc({ type: 'db:schema:apply', change: drop, confirm: 'wrong' })).data).toMatchObject({ code: 'confirm_required' });
      expect((await db.rpc({ type: 'db:schema:apply', change: drop, confirm: 'label' })).error).toBeUndefined();
      expect(db.instance.console!.tables().find(table => table.name === 'scratch')!.columns).not.toHaveProperty('label');

      expect((await db.rpc({ type: 'db:schema:preview', change: { kind: 'alter-column', table: 'notes', column: 'title', nullable: false } })).data)
        .toEqual({ code: 'unsupported' });

      await db.rpc({ type: 'db:schema:apply', change: { kind: 'create-index', table: 'notes', name: 'notes_title', columns: ['title'], unique: false } });
      const indexes = (await db.rpc({ type: 'db:schema:describe', table: 'notes' })).data as { indexes: { name: string; columns: string[] }[] };
      expect(indexes.indexes).toContainEqual(expect.objectContaining({ name: 'notes_title', columns: ['title'] }));
      expect((await db.rpc({ type: 'db:schema:apply', change: { kind: 'drop-index', table: 'notes', name: 'notes_title' }, confirm: 'notes_title' })).error).toBeUndefined();
    } finally { await db.close(); }
  });

  it('creates tables that the data view can use, and finds them again after a restart', async () => {
    const db = await setup();
    try {
      const create = {
        kind: 'create-table', table: 'tasks',
        columns: [{ name: 'id', type: 'integer', primary: true, autoIncrement: true }, { name: 'name', type: 'text', nullable: false, default: '' }],
      };
      expect((await db.rpc({ type: 'db:schema:preview', change: create })).data).toMatchObject({
        statements: ['CREATE TABLE "tasks" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "name" TEXT NOT NULL DEFAULT \'\')'],
      });
      await db.rpc({ type: 'db:schema:apply', change: create });
      expect(db.instance.console!.info().tables).toContain('tasks');
      expect((await db.rpc({ type: 'db:insert', table: 'tasks', row: { name: 'one' } })).data).toMatchObject({ success: true });
      expect((await db.rpc({ type: 'db:select', table: 'tasks', orderBy: { column: 'name', direction: 'asc' } })).data).toMatchObject({ total: 1 });
      await db.restart();
      expect(db.instance.console!.tables()).toContainEqual(expect.objectContaining({ name: 'tasks', discovered: true }));
      expect((await db.rpc({ type: 'db:select', table: 'tasks' })).data).toMatchObject({ total: 1, rows: [{ name: 'one' }] });
    } finally { await db.close(); }
  });

  it('refuses protected tables, reserved and malformed names', async () => {
    const db = await setup();
    try {
      for (const change of [
        { kind: 'add-column', table: 'console_users', column: { name: 'x', type: 'text' } },
        { kind: 'drop-column', table: '__zhin_persistent_state', column: 'value' },
        { kind: 'create-table', table: 'console_evil', columns: [{ name: 'id', type: 'integer' }] },
        { kind: 'create-table', table: 'bad name"; DROP TABLE notes; --', columns: [{ name: 'id', type: 'integer' }] },
        { kind: 'add-column', table: 'notes', column: { name: 'x', type: 'varchar(10)' } },
        { kind: 'add-column', table: 'notes', column: { name: 'req', type: 'text', nullable: false } },
        { kind: 'add-column', table: 'notes', column: { name: 'x', type: 'text', default: { nested: 1 } } },
      ]) {
        const reply = await db.rpc({ type: 'db:schema:apply', change, confirm: 'x' });
        expect(reply.error, JSON.stringify(change)).toBeTruthy();
      }
      expect((await db.rpc({ type: 'db:schema:describe', table: 'console_users' })).data).toEqual({ code: 'protected_table' });
      expect(db.instance.console!.info().tables).toEqual(['notes']);
    } finally { await db.close(); }
  });
});

describe('Console database: non-relational dialects', () => {
  it('reports SQL and schema as unsupported for the memory dialect', async () => {
    const host = createDatabaseHost({ dialect: 'memory' } as never);
    host.define('notes', { id: { type: 'integer', primary: true } });
    await host.start();
    try {
      expect(host.console!.info().capabilities).toMatchObject({ sql: false, schema: false, reason: expect.stringContaining('memory') });
      const request = { requestId: 1, type: 'db:query', sql: 'SELECT 1' };
      const reply = pickRpcReply(request, await dispatchRuntimeConsoleRpc(request, { database: host.console } as never))!;
      expect(reply.data).toEqual({ code: 'unsupported' });
    } finally { await host.stop(); }
  });
});
