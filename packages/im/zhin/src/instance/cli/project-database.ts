/**
 * The project database as CLI helpers open it (`zhin trace`, `zhin usage report`).
 */
import { isAbsolute, join, resolve } from 'node:path';
import { createConfigDocument } from '@zhin.js/runtime';
import { DEFAULT_ROOT_CONFIG_FILE_NAME } from '@zhin.js/plugin-runtime';
import { createDatabaseHost, resolveDatabaseConfig } from '@zhin.js/core/runtime';
import { findConfigFile } from '@zhin.js/gateway/project';

type DatabaseHostConfig = Parameters<typeof createDatabaseHost>[0];

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
  if (config.dialect === 'sqlite' && typeof filename === 'string' && filename !== ':memory:'
    && !filename.startsWith('file::memory:') && !isAbsolute(filename)) {
    return Object.freeze({ ...config, filename: resolve(root, filename) }) as DatabaseHostConfig;
  }
  return config;
}

export async function createCliProjectDatabaseHost(root: string): Promise<ReturnType<typeof createDatabaseHost>> {
  return createDatabaseHost(await resolveCliProjectDatabaseConfig(root));
}
