/**
 * The project database as CLI helpers open it (`zhin trace`, `zhin usage report`).
 */
import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { createConfigDocument } from '@zhin.js/runtime';
import { DEFAULT_ROOT_CONFIG_FILE_NAME } from '@zhin.js/plugin-runtime';
import { createDatabaseHost, resolveDatabaseConfig } from '@zhin.js/core/runtime';
import { findConfigFile } from '@zhin.js/gateway/project';

type DatabaseHostConfig = Parameters<typeof createDatabaseHost>[0];

/** In-memory, temporary (`''`) and URI (`file:…`) SQLite names: passed through untouched. */
function isPlainSqliteFile(filename: string): boolean {
  return filename !== '' && filename !== ':memory:' && !filename.startsWith('file:');
}

/**
 * Resolves the project's `database` block. A relative SQLite file is anchored at the project
 * root, as the gateway does (the instance runs with the root as cwd): `zhin trace --cwd <dir>`
 * otherwise opened `<process cwd>/data/bot.db` — a new, empty file (#1250 b35).
 */
export async function resolveCliProjectDatabaseConfig(root: string): Promise<DatabaseHostConfig> {
  const selected = findConfigFile(root);
  const file = join(root, selected ?? DEFAULT_ROOT_CONFIG_FILE_NAME);
  let document: Record<string, unknown>;
  try {
    document = ((await createConfigDocument(file).read()).document ?? {}) as Record<string, unknown>;
  } catch {
    document = {};
  }
  const config = await resolveDatabaseConfig(root, document);
  const filename = (config as { readonly filename?: unknown }).filename;
  if (config.dialect === 'sqlite' && typeof filename === 'string' && isPlainSqliteFile(filename) && !isAbsolute(filename)) {
    return Object.freeze({ ...config, filename: resolve(root, filename) }) as DatabaseHostConfig;
  }
  return config;
}

/** The project's SQLite file does not exist; a CLI read never creates it (#1250 b35 review). */
export class CliProjectDatabaseMissingError extends Error {
  readonly code = 'project_database_missing';
  constructor(readonly filename: string) {
    super(`project database ${filename} does not exist`);
    this.name = 'CliProjectDatabaseMissingError';
  }
}

/**
 * The project's database Host, not started. Throws {@link CliProjectDatabaseMissingError} for a
 * SQLite file that does not exist: opening it would leave a new, empty database behind (a typo'd
 * `filename`, or a project that never started).
 */
export async function createCliProjectDatabaseHost(root: string): Promise<ReturnType<typeof createDatabaseHost>> {
  const config = await resolveCliProjectDatabaseConfig(root);
  const filename = (config as { readonly filename?: unknown }).filename;
  if (config.dialect === 'sqlite' && typeof filename === 'string' && isPlainSqliteFile(filename) && !existsSync(filename)) {
    throw new CliProjectDatabaseMissingError(filename);
  }
  return createDatabaseHost(config);
}
