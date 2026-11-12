/**
 * The project `database` block as the gateway resolves it (ADR 0054 §7): the same file and
 * driver settings as the instance's `resolveDatabaseConfig` (`@zhin.js/core`), ported here so the
 * gateway never imports IM layers. Keep the two in step.
 */
import { mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { expandEnvironmentValue } from '@zhin.js/plugin-runtime';
import { createConfigDocument } from '@zhin.js/runtime';
import { findConfigFile } from '../project/config-file.js';
import { loadRuntimeEnvironmentLayers } from '../project/environment.js';

export type ProjectDatabaseConfig = {
  readonly dialect: string;
} & Readonly<Record<string, unknown>>;

/** Project-relative default when no `database` block is configured. */
export const DEFAULT_PROJECT_DATABASE_FILE = join('.zhin', 'data.sqlite');

const SUPPORTED_DIALECTS = new Set(['memory', 'mongodb', 'mysql', 'pg', 'redis', 'sqlite']);

function configurationError(path: string, expectation: string, envExample?: string): TypeError {
  const envHint = envExample
    ? `若这里引用环境变量，请在项目根目录 .env 中设置 ${envExample}。`
    : '若这里引用环境变量，请检查项目根目录 .env 中的对应变量。';
  return new TypeError(`数据库配置 ${path} ${expectation}。${envHint}也可运行 \`zhin setup --database\` 重新配置。`);
}

function normalizePort(value: unknown, path: string, envExample: string): number | undefined {
  if (value === undefined) return undefined;
  const normalized = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\d+$/u.test(value.trim()) ? Number(value.trim()) : Number.NaN;
  if (!Number.isInteger(normalized) || normalized < 1 || normalized > 65535) {
    throw configurationError(path, '必须是 1-65535 的整数，当前值为空或无效', envExample);
  }
  return normalized;
}

function normalizeOptionalText(config: Record<string, unknown>, key: string, path: string, envExample?: string): void {
  if (!(key in config)) return;
  const value = config[key];
  if (typeof value !== 'string' || value.trim() === '') throw configurationError(path, '不能为空', envExample);
  config[key] = value.trim();
}

function normalizeRequiredText(config: Record<string, unknown>, key: string, path: string, envExample?: string): void {
  if (!(key in config)) config[key] = undefined;
  normalizeOptionalText(config, key, path, envExample);
}

function normalizeRedisDatabase(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const normalized = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\d+$/u.test(value.trim()) ? Number(value.trim()) : Number.NaN;
  if (!Number.isInteger(normalized) || normalized < 0) {
    throw configurationError('database.database', '必须是大于或等于 0 的整数', 'REDIS_DB=0');
  }
  return normalized;
}

/** Validates an expanded `database` block (port of `normalizeDatabaseHostConfig`). */
export function normalizeProjectDatabaseConfig(input: ProjectDatabaseConfig): ProjectDatabaseConfig {
  const dialect = input.dialect;
  if (!SUPPORTED_DIALECTS.has(dialect)) {
    throw new TypeError(`数据库配置 database.dialect 不支持 ${JSON.stringify(dialect)}；可选值为 sqlite、mysql、pg、mongodb、redis、memory。`);
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
      if (!/^mongodb(?:\+srv)?:\/\//u.test(String(config.url))) throw configurationError('database.url', '必须使用 mongodb:// 或 mongodb+srv://');
      break;
    case 'redis': {
      normalizeOptionalText(config, 'url', 'database.url', 'REDIS_URL=redis://127.0.0.1:6379');
      if (config.socket !== undefined) {
        if (!config.socket || typeof config.socket !== 'object' || Array.isArray(config.socket)) throw configurationError('database.socket', '必须是对象');
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
      if (config.filename === undefined) config.filename = './data/bot.db';
      normalizeOptionalText(config, 'filename', 'database.filename');
      break;
    case 'memory':
      break;
  }
  return Object.freeze(config) as ProjectDatabaseConfig;
}

/**
 * Resolves the expanded root config document's `database` block. A relative SQLite file is
 * anchored at the project root (the instance runs with the project root as cwd, so both
 * processes open the same file).
 */
export async function resolveProjectDatabaseConfig(projectRoot: string, document: unknown): Promise<ProjectDatabaseConfig> {
  const configured = document && typeof document === 'object' ? (document as Record<string, unknown>).database : undefined;
  if (configured && typeof configured === 'object' && !Array.isArray(configured)) {
    const value = configured as Record<string, unknown>;
    const normalized = normalizeProjectDatabaseConfig({ ...value, dialect: typeof value.dialect === 'string' ? value.dialect : 'sqlite' });
    if (normalized.dialect === 'sqlite' && typeof normalized.filename === 'string' && !isSqliteMemory(normalized.filename) && !isAbsolute(normalized.filename)) {
      return Object.freeze({ ...normalized, filename: resolve(projectRoot, normalized.filename) });
    }
    return normalized;
  }
  const filename = join(projectRoot, DEFAULT_PROJECT_DATABASE_FILE);
  await mkdir(dirname(filename), { recursive: true });
  return Object.freeze({ dialect: 'sqlite', filename });
}

/**
 * The root config document with `${…}` expanded against process env and the project `.env`
 * layers of `environment` (missing variables become empty, as in the instance). Only the gateway's
 * own blocks are read from it (`database`, `console.terminal`): plugin declarations are not
 * validated here, so a config the instance rejects still leaves the Console reachable.
 */
export async function loadExpandedProjectConfig(projectRoot: string, environment = 'development'): Promise<Readonly<Record<string, unknown>>> {
  const file = findConfigFile(projectRoot);
  if (!file) return Object.freeze({});
  const [document, layers] = await Promise.all([
    createConfigDocument(join(projectRoot, file)).read().then((snapshot) => snapshot.document),
    loadRuntimeEnvironmentLayers(projectRoot, environment),
  ]);
  if (!document || typeof document !== 'object' || Array.isArray(document)) return Object.freeze({});
  const overlay = layers.environments?.[environment];
  return expandEnvironmentValue(document as Record<string, unknown>, (key) => overlay?.[key] ?? layers.base?.[key] ?? process.env[key]);
}

/** {@link resolveProjectDatabaseConfig} over {@link loadExpandedProjectConfig}. */
export async function loadProjectDatabaseConfig(projectRoot: string, environment = 'development'): Promise<ProjectDatabaseConfig> {
  return resolveProjectDatabaseConfig(projectRoot, await loadExpandedProjectConfig(projectRoot, environment));
}

function isSqliteMemory(filename: string): boolean {
  return filename === ':memory:' || filename.startsWith('file::memory:');
}
