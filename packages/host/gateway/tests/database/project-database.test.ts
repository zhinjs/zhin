import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Registry } from '@zhin.js/database';
import {
  loadProjectDatabaseConfig,
  ProjectDatabase,
  resolveProjectDatabaseConfig,
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

describe('SQLite shared by the gateway and the instance (ADR 0054 §7)', () => {
  it('opens the file in WAL mode; both connections keep their own tables and see each other’s writes', async () => {
    const root = await project();
    const filename = join(root, '.zhin', 'data.sqlite');
    // Gateway: console_* tables only.
    const gateway = new ProjectDatabase({ dialect: 'sqlite', filename });
    expect(defineConsoleIamTables(gateway)).toBe(true);
    await gateway.start();
    closers.push(() => gateway.stop());
    const iam = new ConsoleIamService({ database: gateway, projectRoot: root });
    await iam.start({ timers: false });
    closers.push(async () => { iam.stop(); });

    // Instance: its own tables, opened while the gateway holds the file.
    const instance = Registry.create('sqlite', { filename } as never) as unknown as {
      define(name: string, definition: unknown): void;
      start(): Promise<void>;
      stop(): Promise<void>;
      query(sql: string, params?: unknown[]): Promise<unknown>;
      models: Map<string, { insert(row: Record<string, unknown>): Promise<unknown>; select(...fields: string[]): PromiseLike<unknown[]> & { where(query: Record<string, unknown>): PromiseLike<unknown[]> } }>;
    };
    instance.define('conversation_events', { id: { type: 'text', length: 64, primary: true, nullable: false }, body: { type: 'text', nullable: false } });
    await instance.start();
    closers.push(() => instance.stop());

    expect(await instance.query('PRAGMA journal_mode')).toEqual([{ journal_mode: 'wal' }]);
    // The instance never waits synchronously (its SQLite dialect retries BUSY asynchronously); only the gateway does.
    expect(await instance.query('PRAGMA busy_timeout')).toEqual([{ timeout: 0 }]);

    // Interleaved writes from both connections.
    const owner = await iam.createOwner({ username: 'owner', password: 'correct-horse-battery' });
    await instance.models.get('conversation_events')!.insert({ id: 'e1', body: 'hello' });
    const login = await iam.login('owner', 'correct-horse-battery');
    await instance.models.get('conversation_events')!.insert({ id: 'e2', body: 'world' });
    expect(await iam.authenticate(login.token)).toMatchObject({ kind: 'user', userId: owner.id });
    expect(await instance.models.get('conversation_events')!.select('id')).toHaveLength(2);
    // The instance can read console_* rows too (it does not: the gateway owns them), and its
    // tables are invisible to the gateway's connection.
    expect(await instance.query(`SELECT count(*) AS total FROM ${IAM_TABLES.users}`)).toEqual([{ total: 1 }]);
    expect(gateway.models.get('conversation_events')).toBeUndefined();
    expect(gateway.tables()).not.toContain('conversation_events');
  });

  it('closes the open Host as soon as `zhin console init` creates the owner beside a running gateway', async () => {
    const root = await project();
    const filename = join(root, '.zhin', 'data.sqlite');
    const gateway = new ProjectDatabase({ dialect: 'sqlite', filename });
    defineConsoleIamTables(gateway);
    await gateway.start();
    closers.push(() => gateway.stop());
    // The running gateway: periodic refresh only every 30 s (timers off here).
    const running = new ConsoleIamService({ database: gateway, projectRoot: root });
    await running.start({ timers: false });
    closers.push(async () => { running.stop(); });
    expect(running.initialized()).toBe(false);

    // `zhin console init`: another connection (another process in production).
    const cli = new ProjectDatabase({ dialect: 'sqlite', filename });
    defineConsoleIamTables(cli);
    await cli.start();
    closers.push(() => cli.stop());
    const init = new ConsoleIamService({ database: cli, projectRoot: root });
    await init.start({ timers: false });
    await init.createOwner({ username: 'owner', password: 'correct-horse-battery' });
    init.stop();

    // Fails closed on the setup marker right away, then confirms from the database.
    expect(running.initialized()).toBe(true);
    await expect.poll(() => running.refreshOwnerState()).toBe(true);
    expect(running.initialized()).toBe(true);
  });
});
