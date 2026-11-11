import { isAbsolute, resolve } from 'node:path';
import {
  isDatabaseDriverAvailable,
  probeDatabaseConnection,
  type DatabaseProbeResult,
  type ProbeDialect,
} from '@zhin.js/database';
import { expandEnvironmentValue } from '@zhin.js/plugin-runtime';
import {
  DATABASE_DIALECT_DEFINITIONS,
  validateDatabaseConfig,
  type DatabaseDialectDefinition,
} from '@zhin.js/scaffold-wizard';
import { IamError, type ConsoleIamService, type ConsoleUserView } from './service.js';
import { IAM_DIALECTS } from './tables.js';

export type SetupDialect = ProbeDialect;

export interface SetupDatabaseField {
  readonly name: string;
  readonly type: 'string' | 'integer' | 'enum';
  readonly required: boolean;
  readonly secret: boolean;
  readonly default?: string | number;
  readonly options?: readonly string[];
  /** Env variable a secret is written to. */
  readonly env?: string;
}

export interface SetupDriver {
  readonly dialect: SetupDialect;
  readonly label: string;
  readonly description: string;
  readonly available: boolean;
  readonly missingPackage?: string;
  readonly fields: readonly SetupDatabaseField[];
}

export interface SetupDatabaseSummary {
  readonly dialect: string;
  readonly source: 'default' | 'config';
  /** Connection facts without secrets. */
  readonly summary: Readonly<Record<string, string | number>>;
}

export interface SetupStatus {
  readonly setupRequired: boolean;
  readonly database: SetupDatabaseSummary;
}

export interface SetupDatabaseInput {
  readonly dialect: unknown;
  /** Field values; a secret may be a `${VAR}` reference to an existing variable instead. */
  readonly connection?: unknown;
}

/** Config-file and dotenv access the setup flow needs (ConsoleConfigurationStore satisfies `config`). */
export interface SetupConfigPort {
  readDocument(): Promise<Record<string, unknown>>;
  setKey(key: string, value: unknown): Promise<unknown>;
}

export interface SetupEnvFilePort {
  read(): Promise<string>;
  write(content: string): Promise<void>;
}

export interface ConsoleSetupServiceOptions {
  readonly projectRoot: string;
  readonly config: SetupConfigPort;
  readonly envFile: SetupEnvFilePort;
  /** The access-control service bound to the database currently in use. */
  readonly iam: () => ConsoleIamService | undefined;
  /** Variables for `${…}` expansion (process env + project dotenv layers). */
  readonly environment?: () => Promise<Readonly<Record<string, string | undefined>>>;
  readonly probe?: (dialect: SetupDialect, config: Record<string, unknown>) => Promise<DatabaseProbeResult>;
  readonly driverAvailable?: (dialect: SetupDialect) => Promise<boolean>;
}

const DEFAULT_SQLITE_FILE = '.zhin/data.sqlite';
const SECRET_FIELDS: ReadonlySet<string> = new Set(['password']);
const ENV_REFERENCE = /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/u;

export const SETUP_NO_MIGRATION_NOTICE = '切换数据库不会迁移旧库数据：插件数据仍留在原数据库。';

function envNameFor(field: string): string {
  return `ZHIN_DATABASE_${field.replace(/([a-z0-9])([A-Z])/gu, '$1_$2').toUpperCase()}`;
}

function fieldsOf(definition: DatabaseDialectDefinition): readonly SetupDatabaseField[] {
  const schema = definition.schema as { properties?: Record<string, Record<string, unknown>>; required?: readonly string[] };
  const required = new Set(schema.required ?? []);
  return Object.freeze(Object.entries(schema.properties ?? {}).filter(([name]) => name !== 'dialect').flatMap(([name, property]) => {
    if (property.type === 'object') return [];
    const options = Array.isArray(property.enum) ? (property.enum as string[]) : undefined;
    // A MongoDB URL may embed credentials, so it is treated as a secret.
    const secret = SECRET_FIELDS.has(name) || (definition.dialect === 'mongodb' && name === 'url');
    let defaultValue = property.default as string | number | undefined;
    if (definition.dialect === 'sqlite' && name === 'filename') defaultValue = DEFAULT_SQLITE_FILE;
    return [Object.freeze({
      name,
      type: options ? 'enum' as const : property.type === 'integer' ? 'integer' as const : 'string' as const,
      required: required.has(name) || property.minLength !== undefined,
      secret,
      ...(defaultValue === undefined ? {} : { default: defaultValue }),
      ...(options ? { options: Object.freeze([...options]) } : {}),
      ...(secret ? { env: envNameFor(name) } : {}),
    })];
  }));
}

const SETUP_DEFINITIONS = DATABASE_DIALECT_DEFINITIONS.filter(definition => IAM_DIALECTS.has(definition.dialect));

/**
 * The one setup flow (ADR 0049 §7): `/auth/setup*` and `zhin console init` are thin wrappers.
 * Database changes are written to the config file / `.env`; restarting is the caller's job.
 */
export class ConsoleSetupService {
  readonly #options: ConsoleSetupServiceOptions;

  constructor(options: ConsoleSetupServiceOptions) {
    this.#options = options;
  }

  setupRequired(): boolean {
    const iam = this.#options.iam();
    return !(iam?.initialized() ?? false);
  }

  async status(): Promise<SetupStatus> {
    return Object.freeze({ setupRequired: this.setupRequired(), database: await this.#currentDatabase() });
  }

  async drivers(): Promise<readonly SetupDriver[]> {
    const available = this.#options.driverAvailable ?? ((dialect: SetupDialect) => isDatabaseDriverAvailable(dialect));
    return Promise.all(SETUP_DEFINITIONS.map(async definition => {
      const dialect = definition.dialect as SetupDialect;
      const ok = await available(dialect);
      return Object.freeze({
        dialect,
        label: definition.name,
        description: definition.description,
        available: ok,
        ...(ok || !definition.driver ? {} : { missingPackage: definition.driver.package }),
        fields: fieldsOf(definition),
      });
    }));
  }

  async testDatabase(input: SetupDatabaseInput): Promise<DatabaseProbeResult> {
    this.#assertSetupOpen();
    const prepared = await this.#prepare(input);
    return this.#probe(prepared);
  }

  /** Tests, then writes `database` (secrets as `${…}` into `.env`). */
  async applyDatabase(input: SetupDatabaseInput): Promise<{ restartRequired: true; notice: string }> {
    this.#assertSetupOpen();
    const prepared = await this.#prepare(input);
    const probe = await this.#probe(prepared);
    if (!probe.ok) throw new IamError('invalid_input', `数据库连接失败：${probe.error ?? 'unknown error'}`);
    const envUpdates: Record<string, string> = {};
    const block: Record<string, unknown> = { dialect: prepared.dialect };
    for (const field of prepared.fields) {
      const value = prepared.raw[field.name];
      if (value === undefined || value === '') continue;
      if (field.secret && typeof value === 'string' && !ENV_REFERENCE.test(value)) {
        envUpdates[field.env!] = value;
        block[field.name] = `\${${field.env!}}`;
      } else {
        block[field.name] = value;
      }
    }
    if (Object.keys(envUpdates).length) {
      await this.#options.envFile.write(upsertDotenv(await this.#options.envFile.read(), envUpdates));
    }
    await this.#options.config.setKey('database', block);
    return Object.freeze({ restartRequired: true, notice: SETUP_NO_MIGRATION_NOTICE });
  }

  async createOwner(input: Readonly<{ username: unknown; password: unknown; displayName?: unknown }>): Promise<{ user: ConsoleUserView }> {
    const iam = this.#options.iam();
    if (!iam?.ready) throw new IamError('unavailable', '当前数据库不能存储账号，或尚未就绪');
    if (iam.initialized()) throw new IamError('conflict', '已初始化：请改用 zhin console user 管理用户');
    return { user: await iam.createOwner(input) };
  }

  #assertSetupOpen(): void {
    if (!this.setupRequired()) throw new IamError('conflict', '已初始化：数据库已在使用中');
  }

  async #environment(): Promise<Readonly<Record<string, string | undefined>>> {
    return this.#options.environment ? this.#options.environment() : process.env;
  }

  async #prepare(input: SetupDatabaseInput): Promise<{
    dialect: SetupDialect; fields: readonly SetupDatabaseField[];
    raw: Record<string, unknown>; expanded: Record<string, unknown>;
  }> {
    const definition = SETUP_DEFINITIONS.find(candidate => candidate.dialect === input.dialect);
    if (!definition) throw new IamError('invalid_input', '不支持的数据库：可选 sqlite / mysql / pg / mongodb');
    const connection = input.connection === undefined ? {} : input.connection;
    if (!connection || typeof connection !== 'object' || Array.isArray(connection)) throw new IamError('invalid_input', 'connection 必须是对象');
    const fields = fieldsOf(definition);
    const raw: Record<string, unknown> = {};
    for (const field of fields) {
      let value = (connection as Record<string, unknown>)[field.name];
      if (value === undefined || value === null || value === '') value = field.default;
      if (value === undefined) continue;
      if (field.type === 'integer') {
        const number = typeof value === 'number' ? value : Number(String(value).trim());
        if (!Number.isSafeInteger(number)) throw new IamError('invalid_input', `${field.name} 必须是整数`);
        value = number;
      } else if (typeof value !== 'string') {
        throw new IamError('invalid_input', `${field.name} 必须是字符串`);
      } else {
        value = field.secret ? value : value.trim();
        if (typeof value === 'string' && /[\r\n]/u.test(value)) throw new IamError('invalid_input', `${field.name} 不能包含换行`);
      }
      raw[field.name] = value;
    }
    const env = await this.#environment();
    const expanded = expandEnvironmentValue({ dialect: definition.dialect, ...raw }, key => env[key]) as Record<string, unknown>;
    const issues = validateDatabaseConfig(expanded, env);
    if (issues.length) throw new IamError('invalid_input', issues.map(issue => issue.message).join('; ').slice(0, 500));
    return { dialect: definition.dialect as SetupDialect, fields, raw, expanded };
  }

  #probe(prepared: { dialect: SetupDialect; expanded: Record<string, unknown> }): Promise<DatabaseProbeResult> {
    const { dialect: _dialect, ...config } = prepared.expanded;
    if (prepared.dialect === 'sqlite' && typeof config.filename === 'string' && !isAbsolute(config.filename)) {
      config.filename = resolve(this.#options.projectRoot, config.filename);
    }
    return (this.#options.probe ?? probeDatabaseConnection)(prepared.dialect, config);
  }

  async #currentDatabase(): Promise<SetupDatabaseSummary> {
    const document = await this.#options.config.readDocument();
    const configured = document.database;
    if (!configured || typeof configured !== 'object' || Array.isArray(configured)) {
      return Object.freeze({ dialect: 'sqlite', source: 'default', summary: Object.freeze({ filename: DEFAULT_SQLITE_FILE }) });
    }
    const value = configured as Record<string, unknown>;
    const dialect = typeof value.dialect === 'string' ? value.dialect : 'sqlite';
    const summary: Record<string, string | number> = {};
    for (const key of ['filename', 'host', 'port', 'user', 'database', 'dbName']) {
      const item = value[key];
      if (typeof item === 'string' || typeof item === 'number') summary[key] = item;
    }
    if (typeof value.url === 'string') summary.url = value.url.replace(/\/\/[^@/]*@/u, '//***@');
    return Object.freeze({ dialect, source: 'config', summary: Object.freeze(summary) });
  }
}

/** Sets `KEY=value` lines in dotenv text, keeping every other line. */
export function upsertDotenv(source: string, updates: Readonly<Record<string, string>>): string {
  const lines = source.length ? source.split(/\r?\n/u) : [];
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const pending = new Map(Object.entries(updates));
  const next = lines.map(line => {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/u.exec(line);
    if (!match || !pending.has(match[1]!)) return line;
    const value = pending.get(match[1]!)!;
    pending.delete(match[1]!);
    return `${match[1]}=${quoteDotenv(value)}`;
  });
  for (const [key, value] of pending) next.push(`${key}=${quoteDotenv(value)}`);
  return `${next.join('\n')}\n`;
}

function quoteDotenv(value: string): string {
  if (/[\r\n]/u.test(value)) throw new IamError('invalid_input', '机密值不能包含换行');
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"') && !value.includes('\\')) return `"${value}"`;
  throw new IamError('invalid_input', '机密值不能同时包含单引号与双引号；请改用 --database-password-env 引用已有变量');
}
