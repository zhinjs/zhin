import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabaseHost, installDatabaseHost } from '../../src/plugin-runtime/database-host-installer.js';
import { dispatchRuntimeConsoleRpc, pickRpcReply } from '@zhin.js/host-http';
import { GenerationHandoffStack, Scope, rootPluginId } from '@zhin.js/plugin-runtime';

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

  it('select("*") 抛可读错误（引导显式列名或 count()）', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zhin-db-host-'));
    const host = createDatabaseHost({ dialect: 'sqlite', filename: join(dir, 'star.sqlite') });
    host.define('t', { id: { type: 'integer' } });
    await host.start();
    const model = host.models.get('t')!;
    expect(() => (model.select as (...args: string[]) => unknown)('*')).toThrow(
      /select\(\) requires explicit column names/,
    );
    // 显式列名不受影响
    await model.insert({ id: 1 });
    const rows = await model.select('id').where({ id: 1 });
    expect(rows).toHaveLength(1);
    await host.stop();
    await rm(dir, { recursive: true, force: true });
  });

  it('count aggregates on the DB side and supports where filters', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zhin-db-count-'));
    const host = createDatabaseHost({ dialect: 'sqlite', filename: join(dir, 'count.sqlite') });
    host.define('logs', {
      level: { type: 'text', nullable: false },
      message: { type: 'text', default: '' },
    });
    await host.start();
    const model = host.models.get('logs')!;
    expect(typeof model.count).toBe('function');
    await model.insert({ level: 'info', message: 'a' });
    await model.insert({ level: 'error', message: 'b' });
    await model.insert({ level: 'error', message: 'c' });
    expect(await model.count!()).toBe(3);
    expect(await model.count!({ level: 'error' })).toBe(2);
    expect(await model.count!({ level: 'warn' })).toBe(0);
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

  it('define is idempotent across generations and rejects conflicting definitions', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zhin-db-idem-'));
    const host = createDatabaseHost({ dialect: 'sqlite', filename: join(dir, 'idem.sqlite') });
    host.define('alpha', { id: { type: 'integer' } });
    // 同名同定义：幂等跳过（reload 后新世代会重复 define）
    expect(() => host.define('alpha', { id: { type: 'integer' } })).not.toThrow();
    expect(host.tables()).toEqual(['alpha']);
    // 同名不同定义：报错
    expect(() => host.define('alpha', { id: { type: 'text' } })).toThrow(/different definition/);
    await host.start();
    // started 后同名同定义仍幂等；新表仍拒绝
    expect(() => host.define('alpha', { id: { type: 'integer' } })).not.toThrow();
    expect(() => host.define('beta', { id: { type: 'integer' } })).toThrow(/already started/);
    await host.stop();
    await rm(dir, { recursive: true, force: true });
  });

  it('keeps the shared host running across generation handoff, rollback and disposal', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zhin-db-reload-'));
    const host = createDatabaseHost({ dialect: 'sqlite', filename: join(dir, 'reload.sqlite') });
    const installer = installDatabaseHost(host);
    const runGeneration = () => {
      const scope = new Scope(rootPluginId());
      const handoffs = new GenerationHandoffStack();
      installer({
        resources: scope,
        lifecycle: scope.disposers,
        handoff: handoffs,
        config: undefined as never,
      });
      return { scope, handoff: handoffs.seal()! };
    };

    // 世代 1：定义表并激活
    host.define('smoke', { name: { type: 'text' } });
    const gen1 = runGeneration();
    await gen1.handoff.activateNext();
    expect(host.started).toBe(true);

    // 世代 2（reload）：同名表幂等 define，激活
    host.define('smoke', { name: { type: 'text' } });
    const gen2 = runGeneration();
    await gen2.handoff.activateNext();

    // 旧世代 dispose + 新世代回滚都不能停掉共享 Host
    await gen1.scope.disposers.dispose();
    await gen2.handoff.deactivateNext();
    expect(host.started).toBe(true);

    // reload 后 models.get 仍可用
    const model = host.models.get('smoke');
    expect(model).toBeDefined();
    await model!.insert({ name: 'x' });
    expect(await model!.select().where({ name: 'x' })).toHaveLength(1);

    await host.stop();
    await rm(dir, { recursive: true, force: true });
  });
});
