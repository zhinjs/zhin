import type { DatabaseConfig } from './types.js';

export type DatabaseDialect = DatabaseConfig['dialect'];

export interface DatabaseDriverDefinition {
  readonly package: string;
  readonly version: string;
}

export interface DatabaseDialectDefinition {
  readonly dialect: DatabaseDialect;
  readonly name: string;
  readonly description: string;
  /** Concrete service version covered by the repository's live acceptance tests. */
  readonly verifiedServer: string;
  readonly driver?: DatabaseDriverDefinition;
  readonly schema: Readonly<Record<string, unknown>>;
}

type SchemaIssueKind = 'env_missing' | 'invalid';

export interface DatabaseSchemaIssue {
  readonly kind: SchemaIssueKind;
  readonly path: string;
  readonly message: string;
  readonly envKey?: string;
}

const text = (defaultValue?: string, extras: Record<string, unknown> = {}) => ({
  type: 'string',
  minLength: 1,
  ...(defaultValue === undefined ? {} : { default: defaultValue }),
  ...extras,
});

const port = (defaultValue: number) => ({
  type: 'integer',
  minimum: 1,
  maximum: 65535,
  default: defaultValue,
});

export const DATABASE_DIALECT_DEFINITIONS: readonly DatabaseDialectDefinition[] = Object.freeze([
  {
    dialect: 'sqlite',
    name: 'SQLite',
    description: '推荐，零配置，适合单机 Bot',
    verifiedServer: 'Node.js 内置 node:sqlite（Node.js 22.5+）',
    schema: {
      type: 'object',
      additionalProperties: true,
      required: ['dialect'],
      properties: {
        dialect: { const: 'sqlite' },
        filename: text('./data/bot.db'),
        mode: { type: 'string', enum: ['wal', 'delete', 'memory'], default: 'wal' },
      },
    },
  },
  {
    dialect: 'mysql',
    name: 'MySQL',
    description: '关系型数据库',
    verifiedServer: 'MySQL 8.4 LTS',
    driver: { package: 'mysql2', version: '^3.23.2' },
    schema: {
      type: 'object',
      additionalProperties: true,
      required: ['dialect'],
      properties: {
        dialect: { const: 'mysql' },
        host: text('127.0.0.1'),
        port: port(3306),
        user: text('root'),
        password: { type: 'string' },
        database: text('zhin_bot'),
      },
    },
  },
  {
    dialect: 'pg',
    name: 'PostgreSQL',
    description: '关系型数据库，方言名为 pg',
    verifiedServer: 'PostgreSQL 17',
    driver: { package: 'pg', version: '^8.22.0' },
    schema: {
      type: 'object',
      additionalProperties: true,
      required: ['dialect'],
      properties: {
        dialect: { const: 'pg' },
        host: text('127.0.0.1'),
        port: port(5432),
        user: text('postgres'),
        password: { type: 'string' },
        database: text('zhin_bot'),
      },
    },
  },
  {
    dialect: 'mongodb',
    name: 'MongoDB',
    description: '文档数据库',
    verifiedServer: 'MongoDB 8',
    driver: { package: 'mongodb', version: '^7.5.0' },
    schema: {
      type: 'object',
      additionalProperties: true,
      required: ['dialect', 'url', 'dbName'],
      properties: {
        dialect: { const: 'mongodb' },
        url: text('mongodb://127.0.0.1:27017', { pattern: '^mongodb(?:\\+srv)?://' }),
        dbName: text('zhin_bot'),
      },
    },
  },
  {
    dialect: 'redis',
    name: 'Redis',
    description: '键值数据库',
    verifiedServer: 'Redis 8',
    driver: { package: 'redis', version: '^6.1.0' },
    schema: {
      type: 'object',
      additionalProperties: true,
      required: ['dialect'],
      properties: {
        dialect: { const: 'redis' },
        socket: {
          type: 'object',
          additionalProperties: true,
          required: ['host', 'port'],
          properties: {
            host: text('127.0.0.1'),
            port: port(6379),
          },
        },
        password: { type: 'string' },
        database: { type: 'integer', minimum: 0, default: 0 },
      },
    },
  },
  {
    dialect: 'memory',
    name: 'Memory',
    description: '仅进程内，适合测试，不持久化',
    verifiedServer: 'Zhin 内置实现',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['dialect'],
      properties: { dialect: { const: 'memory' } },
    },
  },
]);

const definitions = new Map(DATABASE_DIALECT_DEFINITIONS.map((definition) => [definition.dialect, definition]));

export function getDatabaseDialectDefinition(dialect: string): DatabaseDialectDefinition | undefined {
  return definitions.get(dialect as DatabaseDialect);
}

export function databaseChoiceLabel(definition: DatabaseDialectDefinition): string {
  const driver = definition.driver
    ? `；驱动 ${definition.driver.package} ${definition.driver.version}`
    : '';
  return `${definition.name}（${definition.description}；当前支持/实机验证 ${definition.verifiedServer}${driver}）`;
}

function expandEnvReferences(
  input: string,
  path: string,
  env: Readonly<Record<string, string | undefined>>,
  issues: DatabaseSchemaIssue[],
): string {
  return input.replace(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::[-=]([^}]*))?\}/gu,
    (_reference, key: string, fallback: string | undefined) => {
      const resolved = env[key];
      if ((resolved === undefined || resolved === '') && fallback !== undefined) return fallback;
      if (resolved === undefined) {
        issues.push({
          kind: 'env_missing',
          path,
          envKey: key,
          message: `环境变量 ${key} 未设置（${path}）`,
        });
        return '';
      }
      return resolved;
    },
  );
}

function validateValue(
  schema: Record<string, unknown>,
  rawValue: unknown,
  path: string,
  env: Readonly<Record<string, string | undefined>>,
  issues: DatabaseSchemaIssue[],
): void {
  let value = rawValue;
  if (typeof value === 'string') {
    const before = issues.length;
    value = expandEnvReferences(value, path, env, issues);
    if (issues.length > before) return;
  }

  if ('const' in schema && value !== schema.const) {
    issues.push({ kind: 'invalid', path, message: `${path} 必须是 ${JSON.stringify(schema.const)}` });
    return;
  }
  const type = schema.type;
  if (type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      issues.push({ kind: 'invalid', path, message: `${path} 必须是对象` });
      return;
    }
    const record = value as Record<string, unknown>;
    const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(record)) {
        if (!(key in properties)) {
          issues.push({ kind: 'invalid', path: `${path}.${key}`, message: `${path}.${key} 不是受支持的配置项` });
        }
      }
    }
    for (const required of (schema.required ?? []) as string[]) {
      if (!(required in record) || record[required] === undefined || record[required] === null) {
        issues.push({ kind: 'invalid', path: `${path}.${required}`, message: `${path}.${required} 不能为空` });
      }
    }
    for (const [key, propertySchema] of Object.entries(properties)) {
      if (record[key] !== undefined) validateValue(propertySchema, record[key], `${path}.${key}`, env, issues);
    }
    return;
  }
  if (type === 'string') {
    if (typeof value !== 'string') {
      issues.push({ kind: 'invalid', path, message: `${path} 必须是字符串` });
      return;
    }
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      issues.push({ kind: 'invalid', path, message: `${path} 不能为空` });
    }
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern, 'u').test(value)) {
      issues.push({ kind: 'invalid', path, message: `${path} 格式无效` });
    }
    if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
      issues.push({ kind: 'invalid', path, message: `${path} 必须是 ${schema.enum.join('、')} 之一` });
    }
    return;
  }
  if (type === 'integer') {
    const numeric = typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+$/u.test(value.trim())
        ? Number(value.trim())
        : Number.NaN;
    if (!Number.isInteger(numeric)) {
      issues.push({ kind: 'invalid', path, message: `${path} 必须是整数` });
      return;
    }
    if (typeof schema.minimum === 'number' && numeric < schema.minimum) {
      issues.push({ kind: 'invalid', path, message: `${path} 不能小于 ${schema.minimum}` });
    }
    if (typeof schema.maximum === 'number' && numeric > schema.maximum) {
      issues.push({ kind: 'invalid', path, message: `${path} 不能大于 ${schema.maximum}` });
    }
  }
}

export function validateDatabaseConfig(
  config: unknown,
  env: Readonly<Record<string, string | undefined>> = {},
): readonly DatabaseSchemaIssue[] {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return [{ kind: 'invalid', path: 'database', message: 'database 必须是对象' }];
  }
  const dialect = (config as Record<string, unknown>).dialect;
  if (typeof dialect !== 'string') {
    return [{ kind: 'invalid', path: 'database.dialect', message: 'database.dialect 不能为空' }];
  }
  const definition = getDatabaseDialectDefinition(dialect);
  if (!definition) {
    return [{
      kind: 'invalid',
      path: 'database.dialect',
      message: `不支持的数据库方言 ${JSON.stringify(dialect)}`,
    }];
  }
  const issues: DatabaseSchemaIssue[] = [];
  validateValue(definition.schema as Record<string, unknown>, config, 'database', env, issues);
  return Object.freeze(issues);
}
