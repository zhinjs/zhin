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
    expect(opened).toEqual([{ host: 'db', database: 'bot', user: 'zhin_console_x', password: 'console-secret', pool: { max: 2, min: 0 } }]);
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
    expect(opened[0]).toMatchObject({ user: 'zhin_console_x', password: 'console-secret', flags: ['-LOCAL_FILES'], multipleStatements: false, pool: { max: 2, min: 0 } });
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
