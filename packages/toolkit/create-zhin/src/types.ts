import type { AISetupConfig } from './ai.js';
import type { AdapterSetupResult } from './adapter.js';

export interface InitOptions {
  name?: string;
  config?: 'json' | 'yaml' | 'toml';
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
  dialect: 'sqlite' | 'mysql' | 'pg' | 'mongodb' | 'redis';
  [key: string]: any;
}

// 数据库配置映射（SQLite 使用 Node 内置 node:sqlite，无需额外安装）
export const DATABASE_PACKAGES: Record<DatabaseConfig['dialect'], string | undefined> = {
  sqlite: undefined,
  mysql: 'mysql2',
  pg: 'pg',
  mongodb: 'mongodb',
  redis: 'redis'
};