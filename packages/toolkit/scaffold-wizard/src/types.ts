import type { AISetupConfig } from './ai.js';
import type { AdapterSetupResult } from './adapter.js';
import { DATABASE_DIALECT_DEFINITIONS } from './database-definitions.js';

export type { AISetupConfig } from './ai.js';
export type { AdapterSetupResult } from './adapter.js';

export interface InitOptions {
  name?: string;
  template?: 'default' | 'life-assistant';
  config?: 'json' | 'yaml';
  runtime?: 'node' | 'bun';
  yes?: boolean;
  httpToken?: string;
  database?: DatabaseConfig;
  ai?: AISetupConfig;
  adapters?: AdapterSetupResult;
  installGlobalCli?: boolean;
  devSkills?: boolean;
}

export interface DatabaseConfig {
  dialect: 'sqlite' | 'mysql' | 'pg' | 'mongodb' | 'redis' | 'memory';
  [key: string]: any;
}

// 数据库驱动映射（SQLite / Memory 使用内置实现，无需额外安装）
export const DATABASE_PACKAGES = Object.freeze(Object.fromEntries(
  DATABASE_DIALECT_DEFINITIONS.map((definition) => [definition.dialect, definition.driver?.package]),
)) as Readonly<Record<DatabaseConfig['dialect'], string | undefined>>;

export const DATABASE_DRIVER_VERSIONS = Object.freeze(Object.fromEntries(
  DATABASE_DIALECT_DEFINITIONS.flatMap((definition) => definition.driver
    ? [[definition.driver.package, definition.driver.version] as const]
    : []),
)) as Readonly<Record<string, string>>;
