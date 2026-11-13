import { randomBytes } from 'node:crypto';
import { MySQL } from '../../src/dialects/mysql.js';
import { PG } from '../../src/dialects/pg.js';

/**
 * A database of its own for one live suite (full-validation, ADR 0059): suites that create roles,
 * marker tables or `console_*` tables no longer share `zhin_test`, so they run in parallel. The
 * database is created by the configured main account (PostgreSQL: it needs CREATEDB; MySQL: the
 * root account from `ZHIN_TEST_MYSQL_ROOT_*`, which grants it to the main account) and dropped
 * when the suite ends.
 */
export interface LiveConnection {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export interface LiveDatabase {
  /** Main-account connection settings of the suite's database. */
  readonly config: LiveConnection;
  /**
   * A role / user the suite created: dropped after the database. (A non-superuser PostgreSQL
   * main account cannot `DROP OWNED BY` a role it is not a member of, so the role's privileges
   * in the database go with the database.)
   */
  adoptRole(name: string): void;
  drop(): Promise<void>;
}

const suffix = (label: string) => `zhin_t_${label.replace(/[^a-z0-9]+/gu, '_').slice(0, 24)}_${process.pid}_${randomBytes(3).toString('hex')}`;

export function livePgBase(): LiveConnection {
  return {
    host: process.env.ZHIN_TEST_PG_HOST ?? '127.0.0.1',
    port: Number(process.env.ZHIN_TEST_PG_PORT ?? 35432),
    user: process.env.ZHIN_TEST_PG_USER ?? 'zhin',
    password: process.env.ZHIN_TEST_PG_PASSWORD ?? 'zhin',
    database: process.env.ZHIN_TEST_PG_DATABASE ?? 'zhin_test',
  };
}

export async function createLivePgDatabase(label: string, base: LiveConnection = livePgBase()): Promise<LiveDatabase> {
  const name = suffix(label);
  const admin = new PG(base as never);
  await admin.start();
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.stop();
  }
  const roles = new Set<string>();
  return {
    config: { ...base, database: name },
    adoptRole: role => { roles.add(role); },
    async drop() {
      const dropper = new PG(base as never);
      await dropper.start();
      try {
        await dropper.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`).catch(() => dropper.query(`DROP DATABASE IF EXISTS "${name}"`));
        for (const role of roles) await dropper.query(`DROP ROLE IF EXISTS "${role.replace(/"/gu, '""')}"`);
      } finally {
        await dropper.stop();
      }
    },
  };
}

export function liveMysqlBase(): LiveConnection {
  return {
    host: process.env.ZHIN_TEST_MYSQL_HOST ?? '127.0.0.1',
    port: Number(process.env.ZHIN_TEST_MYSQL_PORT ?? 33306),
    user: process.env.ZHIN_TEST_MYSQL_USER ?? 'zhin',
    password: process.env.ZHIN_TEST_MYSQL_PASSWORD ?? 'zhin',
    database: process.env.ZHIN_TEST_MYSQL_DATABASE ?? 'zhin_test',
  };
}

/**
 * MySQL: without `ZHIN_TEST_MYSQL_ROOT_PASSWORD` the shared database is used (the main account
 * cannot create databases there) and `drop` does nothing.
 */
export async function createLiveMysqlDatabase(label: string, base: LiveConnection = liveMysqlBase()): Promise<LiveDatabase> {
  const rootPassword = process.env.ZHIN_TEST_MYSQL_ROOT_PASSWORD;
  if (!rootPassword) return { config: base, adoptRole: () => undefined, drop: async () => undefined };
  const root = { ...base, user: process.env.ZHIN_TEST_MYSQL_ROOT_USER ?? 'root', password: rootPassword };
  const name = suffix(label);
  const admin = new MySQL(root as never);
  await admin.start();
  try {
    await admin.query(`CREATE DATABASE \`${name}\``);
    const hosts = await admin.query<Array<{ host: string }>>('SELECT Host AS host FROM mysql.user WHERE User = ?', [base.user] as never[]);
    const literal = (value: string) => `'${value.replace(/\\/gu, '\\\\').replace(/'/gu, "''")}'`;
    for (const { host } of hosts) await admin.query(`GRANT ALL PRIVILEGES ON \`${name}\`.* TO ${literal(base.user)}@${literal(host)}`);
  } finally {
    await admin.stop();
  }
  return {
    config: { ...base, database: name },
    // MySQL users are dropped by the suites themselves (root may always drop them).
    adoptRole: () => undefined,
    async drop() {
      const dropper = new MySQL(root as never);
      await dropper.start();
      try {
        await dropper.query(`DROP DATABASE IF EXISTS \`${name}\``);
      } finally {
        await dropper.stop();
      }
    },
  };
}
