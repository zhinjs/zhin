/**
 * ADR 0059 without a gateway: `zhin console migrate [--revert]`, `zhin console user …` on
 * `.zhin/gateway.db`, `zhin db console-role` refusals and the doctor's storage checks.
 */
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectDatabase } from '@zhin.js/gateway/database';
import { ConsoleIamService, defineConsoleIamTables, IAM_TABLES } from '@zhin.js/gateway/iam';
import { consoleUserActions, runConsoleInit, runConsoleMigrate, type ConsoleCliIo } from '../src/commands/console.js';
import { runConsoleRole } from '../src/commands/db.js';
import { diagnoseGatewayStorage } from '../src/utils/gateway-storage-check.js';

const PASSWORD = 'correct-horse-battery';
const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

async function project(config = 'configVersion: 2\nplugins: {}\n'): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'zgs-'));
  dirs.push(root);
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'bot', dependencies: {} }));
  await writeFile(path.join(root, 'zhin.config.yml'), config);
  return root;
}

function io(): ConsoleCliIo & { logs: string[]; errors: string[] } {
  const logs: string[] = [];
  const errors: string[] = [];
  return {
    logs, errors,
    log: message => { logs.push(message); },
    error: message => { errors.push(message); },
    readStdin: async () => `${PASSWORD}\n`,
    prompt: async () => { throw new Error('unexpected prompt'); },
    hostRunning: async () => false,
  };
}

/** What an earlier version left in the default project database. */
async function seedLegacy(root: string): Promise<void> {
  const legacy = new ProjectDatabase({ dialect: 'sqlite', filename: path.join(root, '.zhin', 'data.sqlite') });
  defineConsoleIamTables(legacy);
  await legacy.start();
  const iam = new ConsoleIamService({ database: legacy, projectRoot: root });
  await iam.start({ timers: false });
  await iam.createOwner({ username: 'owner', password: PASSWORD });
  iam.stop();
  await legacy.stop();
}

async function projectTables(root: string): Promise<string[]> {
  const source = new ProjectDatabase({ dialect: 'sqlite', filename: path.join(root, '.zhin', 'data.sqlite') });
  await source.start();
  try {
    return await source.tableExists(Object.values(IAM_TABLES));
  } finally {
    await source.stop();
  }
}

const noGateway = () => 12345;

describe.runIf(process.platform !== 'win32')('zhin console without a gateway (ADR 0059)', () => {
  it('migrate imports the old tables; user commands then work on gateway.db; --revert puts them back', async () => {
    const root = await project();
    await seedLegacy(root);
    const migrate = io();
    expect(await runConsoleMigrate(root, {}, migrate, noGateway)).toBe(0);
    expect(migrate.logs.join('\n')).toMatch(/已迁移（.*console_users=1/);
    expect(await projectTables(root)).toEqual([]);

    const list = io();
    expect(await consoleUserActions.list(root, list)).toBe(0);
    expect(list.logs.join('\n')).toContain('owner');
    expect(await consoleUserActions.create(root, 'carol', { role: 'viewer', passwordStdin: true }, io())).toBe(0);

    const revert = io();
    expect(await runConsoleMigrate(root, { revert: true }, revert, noGateway)).toBe(0);
    expect(revert.logs.join('\n')).toMatch(/写回项目数据库（.*console_users=2/);
    expect(await projectTables(root)).toEqual(Object.values(IAM_TABLES));

    // A user command migrates again first (the same import the gateway runs).
    const again = io();
    expect(await consoleUserActions.list(root, again)).toBe(0);
    expect(again.logs.join('\n')).toContain('carol');
    expect(await projectTables(root)).toEqual([]);
  });

  it('user commands on a fresh project create gateway.db and the store marker in the project database (ADR 0059 §3)', async () => {
    const root = await project();
    expect(await consoleUserActions.list(root, io())).toBe(0);
    expect(existsSync(path.join(root, '.zhin', 'gateway.db'))).toBe(true);
    // The SQLite project file is created for the marker, so losing gateway.db later is noticed.
    const db = new ProjectDatabase({ dialect: 'sqlite', filename: path.join(root, '.zhin', 'data.sqlite') });
    await db.start();
    expect(await db.readStoreMarker()).toMatchObject({ storeId: expect.stringMatching(/^[0-9a-f]{32}$/u) });
    await db.stop();
  });

  it('reports an unreachable project database instead of opening access control', async () => {
    const root = await project('configVersion: 2\nplugins: {}\ndatabase:\n  dialect: sqlite\n  filename: ./legacy.sqlite\n');
    // The configured database file is a directory: the import cannot look for the old tables.
    await mkdir(path.join(root, 'legacy.sqlite'));
    const out = io();
    expect(await runConsoleMigrate(root, {}, out, noGateway)).toBe(1);
    expect(out.errors.join('\n')).toMatch(/无法连接项目数据库/);
    const users = io();
    expect(await consoleUserActions.list(root, users)).toBe(1);
    expect(users.errors.join('\n')).toMatch(/迁移旧版 Console 账号表失败/);
  });
});

describe('zhin db console-role', () => {
  it('needs PostgreSQL or MySQL', async () => {
    const root = await project();
    const out = io();
    expect(await runConsoleRole(root, {}, out)).toBe(1);
    expect(out.errors.join('\n')).toMatch(/只有 PostgreSQL \/ MySQL 需要受限账号/);
  });

  it('reports a main account that cannot connect', async () => {
    const root = await project('configVersion: 2\nplugins: {}\ndatabase:\n  dialect: pg\n  host: 127.0.0.1\n  port: 1\n  user: zhin\n  database: bot\n');
    const out = io();
    expect(await runConsoleRole(root, { printSql: true }, out)).toBe(1);
    expect(out.errors.join('\n')).toMatch(/无法用主账号连接项目数据库/);
    expect(existsSync(path.join(root, '.env'))).toBe(false);
  });
});

describe('zhin doctor: gateway storage checks', () => {
  it('says nothing is wrong before gateway.db exists and after the import', async () => {
    const root = await project();
    expect(await diagnoseGatewayStorage(root, { uid: noGateway })).toEqual([
      expect.objectContaining({ name: 'Console 账号存储', status: 'ok', message: expect.stringContaining('尚未创建') }),
    ]);
    await seedLegacy(root);
    expect(await runConsoleMigrate(root, {}, io(), noGateway)).toBe(0);
    const checks = await diagnoseGatewayStorage(root);
    expect(checks.map(check => [check.name, check.status])).toEqual(process.platform === 'win32'
      ? [['Console 账号存储', 'ok']]
      : [['gateway.db 权限', 'ok'], ['Console 账号存储', 'ok']]);
  });

  it('warns about old tables that reappeared and about a missing restricted account on PostgreSQL', async () => {
    const root = await project();
    await seedLegacy(root);
    expect(await runConsoleMigrate(root, {}, io(), noGateway)).toBe(0);
    await seedLegacy(root);
    const reappeared = await diagnoseGatewayStorage(root);
    expect(reappeared).toEqual(expect.arrayContaining([expect.objectContaining({ name: '项目库中的旧账号表', status: 'warn' })]));

    const pg = await project('configVersion: 2\nplugins: {}\ndatabase:\n  dialect: pg\n  host: 127.0.0.1\n  port: 1\n  user: zhin\n  database: bot\n');
    const checks = await diagnoseGatewayStorage(pg);
    expect(checks).toEqual(expect.arrayContaining([expect.objectContaining({
      name: 'Console SQL 受限账号', status: 'warn', fix: expect.stringContaining('zhin db console-role'),
    })]));
    const fixed = await diagnoseGatewayStorage(pg, { fix: true });
    expect(fixed).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Console SQL 受限账号', status: 'warn', message: expect.stringContaining('未能创建') })]));
    const configured = await project('configVersion: 2\nplugins: {}\ndatabase:\n  dialect: pg\n  user: zhin\n  console:\n    user: ${ZHIN_DB_CONSOLE_USER}\n    password: ${ZHIN_DB_CONSOLE_PASSWORD}\n');
    await writeFile(path.join(configured, '.env'), 'ZHIN_DB_CONSOLE_USER=zhin_console_x\nZHIN_DB_CONSOLE_PASSWORD=secret\n');
    expect(await diagnoseGatewayStorage(configured)).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Console SQL 受限账号', status: 'ok' })]));
    expect(await readFile(path.join(configured, '.env'), 'utf8')).toContain('ZHIN_DB_CONSOLE_USER');
  });
});

describe.runIf(process.platform !== 'win32')('a lost gateway.db (ADR 0059 §3 修订)', () => {
  it('keeps access control closed, doctor says why, and --reset-store reopens setup with an audit entry', async () => {
    const root = await project();
    await seedLegacy(root);
    expect(await runConsoleMigrate(root, {}, io(), noGateway)).toBe(0);
    for (const suffix of ['', '-wal', '-shm']) await rm(path.join(root, '.zhin', `gateway.db${suffix}`), { force: true });

    const users = io();
    expect(await consoleUserActions.list(root, users)).toBe(1);
    expect(users.errors.join('\n')).toMatch(/zhin console init --reset-store/);
    const checks = await diagnoseGatewayStorage(root);
    expect(checks).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Console 账号存储', status: 'error', fix: expect.stringContaining('--reset-store') })]));

    const init = io();
    init.readStdin = async () => 'new-owner-password-1\n';
    expect(await runConsoleInit(root, { resetStore: true, yes: true, owner: 'neo', passwordStdin: true }, init)).toBe(0);
    expect(init.logs.join('\n')).toMatch(/已重置 Console 账号存储/);
    expect(init.logs.join('\n')).toMatch(/已创建所有者 neo/);
    const after = io();
    expect(await consoleUserActions.list(root, after)).toBe(0);
    expect(after.logs.join('\n')).toContain('neo');
    expect(after.logs.join('\n')).not.toContain('owner\t');
  });
});
