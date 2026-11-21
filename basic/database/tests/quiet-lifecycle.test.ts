import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLogger } from '@zhin.js/logger';
import { Sqlite } from '../src/dialects/sqlite.js';
import { PostgreSQLDialect } from '../src/dialects/pg.js';
import { MySQLDialect } from '../src/dialects/mysql.js';

/**
 * #1250 cli-output-logger-prefix: CLI commands such as `zhin doctor` open and close databases
 * (`.zhin/gateway.db`, the project SQLite file). Closing one must not print an
 * `[INFO] [database] Database disconnected …` line into the command's output.
 */
const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('database lifecycle logging', () => {
  it('logs the disconnect at debug, not info', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zhin-db-quiet-'));
    dirs.push(dir);
    const logger = getLogger('database');
    const info = vi.spyOn(logger, 'info');
    const debug = vi.spyOn(logger, 'debug');
    const db = new Sqlite({ filename: join(dir, 'data.sqlite') });
    await db.start();
    await db.stop();
    expect(info.mock.calls.flat().join('\n')).not.toContain('Database disconnected');
    expect(debug.mock.calls.flat().join('\n')).toContain('Database disconnected from dialect: sqlite');
  });

  it('logs pool creation and close at debug, not info (PostgreSQL / MySQL; pools connect lazily)', async () => {
    const logger = getLogger('database');
    const info = vi.spyOn(logger, 'info');
    const debug = vi.spyOn(logger, 'debug');
    const pg = new PostgreSQLDialect({ host: '127.0.0.1', port: 1, pool: { max: 3 } });
    await pg.connect();
    await pg.disconnect();
    const mysql = new MySQLDialect({ host: '127.0.0.1', port: 1, pool: { max: 4 } });
    await mysql.connect();
    await mysql.disconnect();
    expect(info).not.toHaveBeenCalled();
    const logged = debug.mock.calls.flat().join('\n');
    expect(logged).toContain('PostgreSQL 连接池已创建 (max: 3)');
    expect(logged).toContain('MySQL 连接池已创建 (max: 4)');
  });
});
