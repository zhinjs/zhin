import fs from 'fs-extra';
import path from 'path';
import { InitOptions, DatabaseConfig, buildRuntimeConfigDocument, serializeRuntimeConfig } from '@zhin.js/scaffold-wizard';

// 生成数据库环境变量
export function generateDatabaseEnvVars(config: DatabaseConfig): string {
  const envVars: string[] = [];

  switch (config.dialect) {
    case 'mysql':
      envVars.push(
        '# MySQL 数据库配置',
        `DB_HOST=${config.host || 'localhost'}`,
        `DB_PORT=${config.port || 3306}`,
        `DB_USER=${config.user || 'root'}`,
        `DB_PASSWORD=${config.password || ''}`,
        `DB_DATABASE=${config.database || 'zhin_bot'}`
      );
      break;
    case 'pg':
      envVars.push(
        '# PostgreSQL 数据库配置',
        `DB_HOST=${config.host || 'localhost'}`,
        `DB_PORT=${config.port || 5432}`,
        `DB_USER=${config.user || 'postgres'}`,
        `DB_PASSWORD=${config.password || ''}`,
        `DB_DATABASE=${config.database || 'zhin_bot'}`
      );
      break;
    case 'mongodb':
      envVars.push(
        '# MongoDB 数据库配置',
        `DB_URL=${config.url || 'mongodb://localhost:27017'}`,
        `DB_NAME=${config.dbName || 'zhin_bot'}`
      );
      break;
    case 'redis':
      envVars.push(
        '# Redis 数据库配置',
        `REDIS_HOST=${config.socket?.host || 'localhost'}`,
        `REDIS_PORT=${config.socket?.port || 6379}`,
        `REDIS_PASSWORD=${config.password || ''}`,
        `REDIS_DB=${config.database || 0}`
      );
      break;
    case 'sqlite':
    default:
      // SQLite 不需要额外的环境变量
      break;
  }

  return envVars.length > 0 ? `\n\n${envVars.join('\n')}` : '';
}

/**
 * 创建新 Plugin Runtime 配置文件（顶层 http/database/ai + plugins.<instanceKey>，
 * 与 packages/im/runtime/src/config-composer.ts 的 effectiveSchema 对齐）
 */
export async function createConfigFile(appPath: string, format: string, options: InitOptions): Promise<void> {
  const configFormat = (format === 'json' || format === 'toml' ? format : 'yaml') as 'yaml' | 'json' | 'toml';
  const doc = buildRuntimeConfigDocument(options);
  const filename = configFormat === 'json'
    ? 'zhin.config.json'
    : configFormat === 'toml'
      ? 'zhin.config.toml'
      : 'zhin.config.yml';
  await fs.writeFile(path.join(appPath, filename), serializeRuntimeConfig(doc, configFormat));
}
