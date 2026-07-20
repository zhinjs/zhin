import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabaseHost } from '../../src/plugin-runtime/database-host-installer.js';
import { dispatchRuntimeConsoleRpc, pickRpcReply } from '@zhin.js/host-http';

describe('DatabaseHost', () => {
  it('tracks defined table names via tables()', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zhin-db-host-'));
    const host = createDatabaseHost({ dialect: 'sqlite', filename: join(dir, 't.sqlite') });
    expect(host.tables()).toEqual([]);
    host.define('alpha', { id: { type: 'integer' } });
    host.define('beta', { id: { type: 'integer' } });
    expect(host.tables()).toEqual(['alpha', 'beta']);
    await rm(dir, { recursive: true, force: true });
  });

  it('defines tables, starts sqlite, and persists rows', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zhin-db-host-'));
    const filename = join(dir, 'test.sqlite');
    const host = createDatabaseHost({ dialect: 'sqlite', filename });
    host.define('smoke', {
      name: { type: 'text', nullable: false },
      value: { type: 'text', default: '' },
    });
    expect(host.started).toBe(false);
    await host.start();
    expect(host.started).toBe(true);
    const model = host.models.get('smoke');
    expect(model).toBeDefined();
    await model!.insert({ name: 'a', value: '1' });
    const rows = await model!.select().where({ name: 'a' });
    expect(rows).toEqual([expect.objectContaining({ name: 'a', value: '1' })]);
    await host.stop();
    await rm(dir, { recursive: true, force: true });
  });

  it('provides the complete Console CRUD administration port', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zhin-db-console-'));
    const host = createDatabaseHost({ dialect: 'sqlite', filename: join(dir, 'console.sqlite') });
    host.define('notes', {
      name: { type: 'text', nullable: false },
      body: { type: 'text', default: '' },
    });
    await host.start();
    const database = host.console!;

    expect(database.info()).toMatchObject({
      dialect: 'sqlite',
      type: 'related',
      tables: ['notes'],
      connected: true,
    });
    expect(database.tables()).toEqual([{
      name: 'notes',
      columns: expect.objectContaining({ name: expect.any(Object) }),
    }]);

    const rpc = async (message: Record<string, unknown>) => {
      const payloads = await dispatchRuntimeConsoleRpc(message, {
        authScope: 'full',
        listPages: async () => [],
        database,
      });
      return pickRpcReply(message, payloads);
    };

    expect(await rpc({ type: 'db:insert', requestId: 1, table: 'notes', row: { name: 'a', body: 'one' } }))
      .toMatchObject({ data: { success: true } });
    expect(await rpc({ type: 'db:insert', requestId: 2, table: 'notes', row: { name: 'b', body: 'two' } }))
      .toMatchObject({ data: { success: true } });

    const selected = await rpc({ type: 'db:select', requestId: 3, table: 'notes', page: 1, pageSize: 1 });
    expect(selected?.data).toMatchObject({ total: 2, page: 1, pageSize: 1 });
    expect((selected?.data as { rows: unknown[] }).rows).toHaveLength(1);

    expect(await rpc({
      type: 'db:update',
      requestId: 4,
      table: 'notes',
      row: { body: 'updated' },
      where: { name: 'a' },
    })).toMatchObject({ data: { success: true } });
    expect(await database.select('notes', 1, 10, { name: 'a' })).toMatchObject({
      rows: [expect.objectContaining({ body: 'updated' })],
    });

    expect(await rpc({ type: 'db:delete', requestId: 5, table: 'notes', where: { name: 'b' } }))
      .toMatchObject({ data: { success: true } });
    expect(await database.select('notes', 1, 10)).toMatchObject({ total: 1 });

    expect(await rpc({ type: 'db:drop-table', requestId: 6, table: 'notes' }))
      .toMatchObject({ data: { success: true } });
    expect(database.tables()).toEqual([]);

    await host.stop();
    await rm(dir, { recursive: true, force: true });
  });
});
