export interface InitOptions {
  name?: string;
  config?: 'json' | 'yaml' | 'toml' | 'ts' | 'js';
  runtime?: 'node' | 'bun';
  yes?: boolean;
  httpUsername?: string;
  httpPassword?: string;
  database?: DatabaseConfig;
}

export interface DatabaseConfig {
  dialect: 'sqlite' | 'mysql' | 'pg' | 'mongodb' | 'redis';
  [key: string]: any;
}

// 数据库配置映射
export const DATABASE_PACKAGES = {
  sqlite: 'sqlite3',
  mysql: 'mysql2',
  pg: 'pg',
  mongodb: 'mongodb',
  redis: 'redis'
} as const;