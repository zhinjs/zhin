import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CONSOLE_ROLE_MISSING_REASON,
  createDatabaseHost,
} from '../../src/plugin-runtime/im/host/database-host-installer.js';
import { normalizeDatabaseHostConfig } from '../../src/plugin-runtime/im/host/database-config.js';

/**
 * ADR 0059 §4: on PostgreSQL / MySQL raw Console SQL runs only on the restricted account's own
 * connection, after a probe; without one it is off with a reason. SQLite needs no account.
 */
type Fake = {
  start: () => Promise<void>;
  stop: ReturnType<typeof vi.fn>;
  query: ReturnType<typeof vi.fn>;
  transaction: ReturnType<typeof vi.fn>;
};

function pgRestricted(overrides: Record<string, unknown> = {}): Fake {
  return {
    start: async () => undefined,
    stop: vi.fn(async () => undefined),
    query: vi.fn(async (sql: string) => {
      if (/FROM pg_roles r/.test(sql)) {
        return [{ user: 'zhin_console_x', session: 'zhin_console_x', super: false, createrole: false, createdb: false, bypassrls: false, replication: false, schema_create: false, database_create: false, memberships: 0, ...overrides }];
      }
      if (/pg_has_role/.test(sql)) return [{ usage: false }];
      if (/unnest\(s.setconfig\)/.test(sql)) return [{ setting: 'search_path=public' }, { setting: 'statement_timeout=60s' }];
      if (/standard_conforming_strings/.test(sql)) return [{ value: 'on' }];
      return [];
    }),
    transaction: vi.fn(async (callback: (trx: unknown) => Promise<unknown>) => callback({
      query: async () => [],
      queryStatement: async (sql: string) => Object.assign([{ ran: sql }], { command: 'SELECT' }),
    })),
  };
}

function pgHost(restricted: Fake | (() => Fake), options: { console?: boolean; now?: () => number } = {}) {
  const opened: Array<Record<string, unknown>> = [];
  const host = createDatabaseHost({
    dialect: 'pg', host: 'db', user: 'zhin', password: 'main-secret', database: 'bot',
    ...(options.console === false ? {} : { console: { user: 'zhin_console_x', password: 'console-secret' } }),
  } as never, {
    openConsoleConnection: (_dialect, connection) => {
      opened.push({ ...connection });
      return typeof restricted === 'function' ? restricted() : restricted;
    },
    ...(options.now ? { now: options.now, consoleProbeIntervalMs: 1000 } : {}),
  });
  const main = host.db as unknown as { start(): Promise<void>; stop(): Promise<void>; query: ReturnType<typeof vi.fn>; transaction: ReturnType<typeof vi.fn> };
  const grants: string[] = [];
  main.start = async () => undefined;
  main.stop = async () => undefined;
  main.query = vi.fn(async (sql: string) => {
    if (/current_user AS account/.test(sql)) return [{ account: 'zhin' }];
    if (/FROM pg_class/.test(sql)) return [{ name: 'notes', grantable: true }, { name: 'console_users', grantable: true }];
    if (/^(GRANT|REVOKE)/.test(sql)) grants.push(sql);
    if (/standard_conforming_strings/.test(sql)) return [{ value: 'on' }];
    return [];
  });
  main.transaction = vi.fn(async () => { throw new Error('raw Console SQL must not use the main account'); });
  return { host, main, opened, grants };
}

describe('Console SQL on PostgreSQL / MySQL: restricted account only', () => {
  it('turns raw SQL off with a reason when database.console is missing; the schema editor stays', async () => {
    const restricted = pgRestricted();
    const { host, main, opened } = pgHost(restricted, { console: false });
    await host.start();
    expect(host.console!.info().capabilities).toMatchObject({
      sql: false, schema: true, sqlIsolation: 'restricted-credential', sqlReason: CONSOLE_ROLE_MISSING_REASON,
    });
    expect(CONSOLE_ROLE_MISSING_REASON).toMatch(/zhin db console-role/);
    await expect(host.console!.query!('SELECT 1')).rejects.toMatchObject({ code: 'unsupported', message: CONSOLE_ROLE_MISSING_REASON });
    await expect(host.console!.execute!('DELETE FROM notes')).rejects.toMatchObject({ code: 'unsupported' });
    expect(opened).toEqual([]);
    expect(main.transaction).not.toHaveBeenCalled();
  });

  it('runs raw SQL on its own pool as the console user, after refreshing grants and probing', async () => {
    const restricted = pgRestricted();
    const { host, main, opened, grants } = pgHost(restricted);
    await host.start();
    // The restricted pool: console credentials, at most two connections, never the main password.
    expect(opened).toEqual([{ host: 'db', database: 'bot', user: 'zhin_console_x', password: 'console-secret', pool: { max: 2, min: 0 }, resetSession: true }]);
    // Grants refreshed with the main account: instance tables granted, a leftover gateway table revoked.
    expect(grants).toEqual(expect.arrayContaining([
      'GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public."notes" TO "zhin_console_x"',
      'REVOKE ALL ON TABLE public."console_users" FROM "zhin_console_x"',
    ]));
    expect(host.console!.info().capabilities).toMatchObject({ sql: true, sqlIsolation: 'restricted-credential' });
    expect(host.console!.info().capabilities).not.toHaveProperty('sqlReason');
    expect(await host.console!.query!('SELECT 1')).toMatchObject({ rowCount: 1 });
    await host.console!.execute!('UPDATE notes SET body = 1', { dryRun: true });
    expect(restricted.transaction).toHaveBeenCalledTimes(2);
    expect(main.transaction).not.toHaveBeenCalled();
    await host.stop();
    expect(restricted.stop).toHaveBeenCalled();
  });

  it('keeps raw SQL off when the account holds too much, and probes again at most every interval', async () => {
    let now = 0;
    let attributes: Record<string, unknown> = { createrole: true };
    const fakes: Fake[] = [];
    const { host } = pgHost(() => {
      const fake = pgRestricted(attributes);
      fakes.push(fake);
      return fake;
    }, { now: () => now });
    await host.start();
    expect(host.console!.info().capabilities).toMatchObject({ sql: false, sqlReason: expect.stringContaining('CREATEROLE') });
    expect(fakes[0]!.stop).toHaveBeenCalled();
    attributes = {};
    // Within the interval: no new probe.
    now = 500;
    await expect(host.console!.query!('SELECT 1')).rejects.toMatchObject({ code: 'unsupported' });
    expect(fakes).toHaveLength(1);
    now = 2000;
    expect(await host.console!.query!('SELECT 1')).toMatchObject({ rowCount: 1 });
    expect(fakes).toHaveLength(2);
    expect(host.console!.info().capabilities).toMatchObject({ sql: true });
  });

  it('keeps raw SQL off when the account cannot log in', async () => {
    const { host } = pgHost(() => ({ ...pgRestricted(), start: async () => { throw new Error('password authentication failed for user "zhin_console_x"'); } }));
    await host.start();
    expect(host.console!.info().capabilities).toMatchObject({ sql: false, sqlReason: expect.stringContaining('password authentication failed') });
  });

  it('opens MySQL connections without LOCAL INFILE and multiple statements', async () => {
    const opened: Array<Record<string, unknown>> = [];
    const host = createDatabaseHost({
      dialect: 'mysql', host: 'db', user: 'zhin', password: 'x', database: 'bot', multipleStatements: true,
      console: { user: 'zhin_console_x', password: 'console-secret' },
    } as never, { openConsoleConnection: (_dialect, options) => { opened.push({ ...options }); return pgRestricted(); } });
    const main = host.db as unknown as { start(): Promise<void>; query(sql: string): Promise<unknown> };
    main.start = async () => undefined;
    main.query = async () => [];
    await host.start();
    expect(opened[0]).toMatchObject({ user: 'zhin_console_x', password: 'console-secret', flags: ['-LOCAL_FILES', '-MULTI_STATEMENTS'], multipleStatements: false, pool: { max: 2, min: 0 }, resetSession: true });
    expect(opened[0]).not.toHaveProperty('infileStreamFactory');
  });

  it('never hands database.console to the main connection', () => {
    const host = createDatabaseHost({ dialect: 'pg', user: 'zhin', console: { user: 'zhin_console_x', password: 'p' } } as never);
    expect((host.db as unknown as { config?: Record<string, unknown> }).config ?? {}).not.toHaveProperty('console');
  });
});

describe('Console SQL on SQLite: separate store', () => {
  it('reports separate-store isolation and forces denyAttach on the instance connection', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zhin-console-credential-'));
    try {
      const config = normalizeDatabaseHostConfig({ dialect: 'sqlite', filename: join(directory, 'bot.db'), denyAttach: false, console: { user: 'x', password: 'y' } });
      expect(config).toMatchObject({ denyAttach: true });
      expect(config).not.toHaveProperty('console');
      const host = createDatabaseHost(config);
      await host.start();
      expect(host.console!.info().capabilities).toMatchObject({ sql: true, sqlIsolation: 'separate-store' });
      await expect(host.console!.execute!(`ATTACH DATABASE '${join(directory, 'gateway.db')}' AS g`)).rejects.toThrow();
      await host.stop();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('database.console in the instance config', () => {
  it('validates the block for PostgreSQL / MySQL and treats unset variables as no account', () => {
    expect(normalizeDatabaseHostConfig({ dialect: 'pg', user: 'zhin', console: { user: ' zhin_console_x ', password: 'p' } }))
      .toMatchObject({ console: { user: 'zhin_console_x', password: 'p' } });
    expect(normalizeDatabaseHostConfig({ dialect: 'mysql', console: { user: '', password: '' } })).not.toHaveProperty('console');
    expect(() => normalizeDatabaseHostConfig({ dialect: 'pg', user: 'zhin', console: { user: 'zhin', password: 'p' } })).toThrow(/database\.console\.user/);
    expect(() => normalizeDatabaseHostConfig({ dialect: 'pg', console: 'x' })).toThrow(/database\.console/);
    expect(() => normalizeDatabaseHostConfig({ dialect: 'pg', console: { user: 'r' } })).toThrow(/database\.console\.password/);
  });
});

describe('restricted account: review follow-ups', () => {
  it('builds the restricted pool from a connection string without the main credentials', async () => {
    const opened: Array<Record<string, unknown>> = [];
    const host = createDatabaseHost({
      dialect: 'pg', connectionString: 'postgresql://zhin:main-secret@db:5432/bot?user=zhin&password=main-secret&sslmode=disable',
      console: { user: 'zhin_console_x', password: 'console-secret' },
    } as never, { openConsoleConnection: (_dialect, options) => { opened.push({ ...options }); return pgRestricted(); } });
    const main = host.db as unknown as { start(): Promise<void>; query(sql: string): Promise<unknown> };
    main.start = async () => undefined;
    main.query = async (sql: string) => (/current_user AS account/.test(sql) ? [{ account: 'zhin' }] : []);
    await host.start();
    const url = new URL(String(opened[0]!.connectionString));
    expect([url.username, url.password, url.searchParams.get('user'), url.searchParams.get('password')]).toEqual(['', '', 'zhin_console_x', 'console-secret']);
    expect(JSON.stringify(opened[0])).not.toContain('main-secret');
    expect(host.console!.info().capabilities).toMatchObject({ sql: true });
  });

  it('refuses a MySQL connection the driver would open with LOCAL_FILES or multiple statements', async () => {
    const unsafe = { ...pgRestricted(), dialect: { connectionSafety: () => ({ localFiles: true, multipleStatements: false }) } };
    const host = createDatabaseHost({ dialect: 'mysql', user: 'zhin', console: { user: 'zhin_console_x', password: 'p' } } as never, { openConsoleConnection: () => unsafe });
    const main = host.db as unknown as { start(): Promise<void>; query(sql: string): Promise<unknown> };
    main.start = async () => undefined;
    main.query = async () => [];
    await host.start();
    expect(host.console!.info().capabilities).toMatchObject({ sql: false, sqlReasonCode: 'console-role-invalid', sqlReason: expect.stringContaining('LOAD DATA LOCAL') });
  });

  it('probes a healthy account again after its TTL and after an error, and turns raw SQL off when it changed', async () => {
    let now = 0;
    let attributes: Record<string, unknown> = {};
    const restricted = pgRestricted();
    restricted.query.mockImplementation(async (sql: string) => {
      if (/FROM pg_roles r WHERE r.rolname = current_user$/.test(sql.trim()) && /session_user/.test(sql)) {
        return [{ user: 'zhin_console_x', session: 'zhin_console_x', super: false, createrole: false, createdb: false, bypassrls: false, replication: false, schema_create: false, database_create: false, memberships: 0, ...attributes }];
      }
      if (/unnest\(s.setconfig\)/.test(sql)) return [{ setting: 'search_path=public' }, { setting: 'statement_timeout=60s' }];
      if (/has_schema_privilege\(current_user, n.oid/.test(sql)) return attributes.creatable ? [{ name: 'zhin' }] : [];
      if (/standard_conforming_strings/.test(sql)) return [{ value: 'on' }];
      return [];
    });
    const { host } = pgHost(restricted, { now: () => now });
    await host.start();
    expect(await host.console!.query!('SELECT 1')).toMatchObject({ rowCount: 1 });
    const probes = () => restricted.query.mock.calls.filter(([sql]) => /session_user/.test(String(sql))).length;
    expect(probes()).toBe(1);
    now = 30_000;
    await host.console!.query!('SELECT 1');
    expect(probes()).toBe(1);
    // An error on the restricted connection: the next use probes first.
    restricted.transaction.mockImplementationOnce(async () => { throw Object.assign(new Error('permission denied for schema public'), { code: '42501' }); });
    await expect(host.console!.execute!('CREATE TABLE x (a int)')).rejects.toThrow(/permission denied/);
    await host.console!.query!('SELECT 1');
    expect(probes()).toBe(2);
    // The account gained CREATE on a schema meanwhile (CVE-2018-1058 precondition): TTL re-probe turns raw SQL off.
    attributes = { creatable: true };
    now = 200_000;
    await expect(host.console!.query!('SELECT 1')).rejects.toMatchObject({ code: 'unsupported' });
    expect(host.console!.info().capabilities).toMatchObject({ sql: false, sqlReasonCode: 'console-role-invalid', sqlReason: expect.stringContaining('may CREATE in schema zhin') });
  });

  it('reports why raw SQL is off as a code', async () => {
    const { host } = pgHost(pgRestricted(), { console: false });
    await host.start();
    expect(host.console!.info().capabilities).toMatchObject({ sqlReasonCode: 'console-role-missing' });
  });
});

describe('raw database handle of plugins (frozen view)', () => {
  it('hides the dialect, its config and the driver handle, and refuses writes to them', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zhin-raw-view-'));
    try {
      const host = createDatabaseHost(normalizeDatabaseHostConfig({ dialect: 'sqlite', filename: join(directory, 'bot.db') }));
      host.define('notes', { id: { type: 'integer', primary: true } });
      await host.start();
      const raw = host.getRawDatabase() as unknown as Record<string, unknown> & { models: Map<string, Record<string, unknown>>; query(sql: string): Promise<unknown> };
      expect(raw.dialect).toBeUndefined();
      expect(raw.config).toBeUndefined();
      expect(raw.dialectName).toBe('sqlite');
      expect(Reflect.set(raw, 'dialect', {})).toBe(false);
      expect(raw.models.has('notes')).toBe(true);
      const model = raw.models.get('notes')!;
      expect(model.database).toBeUndefined();
      expect(() => raw.models.set('x', {})).toThrow(/read-only/);
      expect(() => raw.models.get('console_users')).toThrow(/management gateway/);
      expect(await raw.query('SELECT id FROM notes')).toEqual([]);
      await expect(raw.query(`ATTACH DATABASE '${join(directory, 'gateway.db')}' AS g`)).rejects.toThrow(/ATTACH DATABASE is not allowed/);
      await host.stop();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
