export type DatabaseHostConfig = {
  readonly dialect: string;
} & Record<string, unknown>;

const SUPPORTED_DIALECTS = new Set(['memory', 'mongodb', 'mysql', 'pg', 'redis', 'sqlite']);

function configurationError(path: string, expectation: string, envExample?: string): TypeError {
  const envHint = envExample
    ? `若这里引用环境变量，请在项目根目录 .env 中设置 ${envExample}。`
    : '若这里引用环境变量，请检查项目根目录 .env 中的对应变量。';
  return new TypeError(
    `数据库配置 ${path} ${expectation}。${envHint}也可运行 \`zhin setup --database\` 重新配置。`,
  );
}

function normalizePort(value: unknown, path: string, envExample: string): number | undefined {
  if (value === undefined) return undefined;
  const normalized = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\d+$/u.test(value.trim())
      ? Number(value.trim())
      : Number.NaN;
  if (!Number.isInteger(normalized) || normalized < 1 || normalized > 65535) {
    throw configurationError(path, '必须是 1-65535 的整数，当前值为空或无效', envExample);
  }
  return normalized;
}

function normalizeOptionalText(
  config: Record<string, unknown>,
  key: string,
  path: string,
  envExample?: string,
): void {
  if (!(key in config)) return;
  const value = config[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw configurationError(path, '不能为空', envExample);
  }
  config[key] = value.trim();
}

function normalizeRequiredText(
  config: Record<string, unknown>,
  key: string,
  path: string,
  envExample?: string,
): void {
  if (!(key in config)) config[key] = undefined;
  normalizeOptionalText(config, key, path, envExample);
}

function normalizeRedisDatabase(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const normalized = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\d+$/u.test(value.trim())
      ? Number(value.trim())
      : Number.NaN;
  if (!Number.isInteger(normalized) || normalized < 0) {
    throw configurationError('database.database', '必须是大于或等于 0 的整数', 'REDIS_DB=0');
  }
  return normalized;
}

/**
 * Validate and normalize the expanded Root database configuration before a
 * third-party driver sees it. Dotenv expansion produces strings, while the
 * network clients require numeric ports and otherwise surface opaque NaN
 * socket errors.
 */
export function normalizeDatabaseHostConfig(input: DatabaseHostConfig): DatabaseHostConfig {
  const dialect = input.dialect;
  if (!SUPPORTED_DIALECTS.has(dialect)) {
    throw new TypeError(
      `数据库配置 database.dialect 不支持 ${JSON.stringify(dialect)}；`
      + '可选值为 sqlite、mysql、pg、mongodb、redis、memory。',
    );
  }

  const config: Record<string, unknown> = { ...input, dialect };
  switch (dialect) {
    case 'mysql':
      normalizeOptionalText(config, 'host', 'database.host', 'DB_HOST=127.0.0.1');
      normalizeOptionalText(config, 'user', 'database.user', 'DB_USER=root');
      normalizeOptionalText(config, 'database', 'database.database', 'DB_DATABASE=zhin_bot');
      normalizeOptionalText(config, 'uri', 'database.uri');
      config.port = normalizePort(config.port, 'database.port', 'DB_PORT=3306');
      if (config.port === undefined) delete config.port;
      break;
    case 'pg':
      normalizeOptionalText(config, 'host', 'database.host', 'DB_HOST=127.0.0.1');
      normalizeOptionalText(config, 'user', 'database.user', 'DB_USER=postgres');
      normalizeOptionalText(config, 'database', 'database.database', 'DB_DATABASE=zhin_bot');
      normalizeOptionalText(config, 'connectionString', 'database.connectionString');
      config.port = normalizePort(config.port, 'database.port', 'DB_PORT=5432');
      if (config.port === undefined) delete config.port;
      break;
    case 'mongodb':
      normalizeRequiredText(config, 'url', 'database.url', 'DB_URL=mongodb://127.0.0.1:27017');
      normalizeRequiredText(config, 'dbName', 'database.dbName', 'DB_NAME=zhin_bot');
      break;
    case 'redis': {
      normalizeOptionalText(config, 'url', 'database.url', 'REDIS_URL=redis://127.0.0.1:6379');
      if (config.socket !== undefined) {
        if (!config.socket || typeof config.socket !== 'object' || Array.isArray(config.socket)) {
          throw configurationError('database.socket', '必须是对象');
        }
        const socket = { ...(config.socket as Record<string, unknown>) };
        normalizeOptionalText(socket, 'host', 'database.socket.host', 'REDIS_HOST=127.0.0.1');
        socket.port = normalizePort(socket.port, 'database.socket.port', 'REDIS_PORT=6379');
        if (socket.port === undefined) delete socket.port;
        config.socket = Object.freeze(socket);
      }
      config.database = normalizeRedisDatabase(config.database);
      if (config.database === undefined) delete config.database;
      break;
    }
    case 'sqlite':
      normalizeOptionalText(config, 'filename', 'database.filename');
      break;
    case 'memory':
      break;
  }
  return Object.freeze(config) as DatabaseHostConfig;
}
