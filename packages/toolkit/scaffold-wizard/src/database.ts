import inquirer from 'inquirer';
import { DatabaseConfig } from './types.js';
import {
  DATABASE_DIALECT_DEFINITIONS,
  databaseChoiceLabel,
  getDatabaseDialectDefinition,
  validateDatabaseConfig,
  type DatabaseDialect,
} from './database-definitions.js';

function schemaDefault(dialect: DatabaseDialect, ...path: string[]): unknown {
  let schema = getDatabaseDialectDefinition(dialect)?.schema as Record<string, unknown> | undefined;
  for (const segment of path) {
    const properties = schema?.properties as Record<string, Record<string, unknown>> | undefined;
    schema = properties?.[segment];
  }
  return schema?.default;
}

function parseIntegerInput(input: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number | string {
  const raw = String(input).trim();
  if (!/^\d+$/u.test(raw)) return `请输入有效的整数 (${minimum}-${maximum})`;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    return `请输入有效的整数 (${minimum}-${maximum})`;
  }
  return value;
}

// 配置数据库选项
export async function configureDatabaseOptions(): Promise<DatabaseConfig> {
  const { dialect } = await inquirer.prompt([
    {
      type: 'select',
      name: 'dialect',
      message: '选择数据库类型:',
      choices: DATABASE_DIALECT_DEFINITIONS.map((definition) => ({
        name: databaseChoiceLabel(definition),
        value: definition.dialect,
      })),
      default: 'sqlite'
    }
  ]);

  let config: DatabaseConfig;
  switch (dialect) {
    case 'sqlite':
      config = await configureSQLite();
      break;
    case 'mysql':
      config = await configureMySQL();
      break;
    case 'pg':
      config = await configurePostgreSQL();
      break;
    case 'mongodb':
      config = await configureMongoDB();
      break;
    case 'redis':
      config = await configureRedis();
      break;
    case 'memory':
      config = { dialect: 'memory' };
      break;
    default:
      throw new Error(`未支持的数据库类型: ${dialect}`);
  }
  const issues = validateDatabaseConfig(config);
  if (issues.length > 0) {
    throw new TypeError(`数据库配置不符合 Schema：${issues.map((issue) => issue.message).join('；')}`);
  }
  return config;
}

// SQLite 配置
async function configureSQLite(): Promise<DatabaseConfig> {
  const { filename, mode } = await inquirer.prompt([
    {
      type: 'input',
      name: 'filename',
      message: 'SQLite 数据库文件路径:',
      default: schemaDefault('sqlite', 'filename'),
      validate: (input: string) => {
        if (!input.trim()) return '文件路径不能为空';
        return true;
      }
    },
    {
      type: 'select',
      name: 'mode',
      message: 'SQLite 模式:',
      choices: [
        { name: 'WAL (推荐, 并发性能好)', value: 'wal' },
        { name: 'DELETE (默认)', value: 'delete' },
        { name: 'MEMORY (内存数据库)', value: 'memory' }
      ],
      default: schemaDefault('sqlite', 'mode')
    }
  ]);

  return {
    dialect: 'sqlite',
    filename,
    mode
  };
}

// MySQL 配置
async function configureMySQL(): Promise<DatabaseConfig> {
  const config = await inquirer.prompt([
    {
      type: 'input',
      name: 'host',
      message: 'MySQL 主机地址:',
      default: schemaDefault('mysql', 'host')
    },
    {
      type: 'input',
      name: 'port',
      message: 'MySQL 端口:',
      default: String(schemaDefault('mysql', 'port')),
      validate: (input: string) => {
        const value = parseIntegerInput(input, 1, 65535);
        return typeof value === 'number' ? true : value;
      }
    },
    {
      type: 'input',
      name: 'user',
      message: 'MySQL 用户名:',
      default: schemaDefault('mysql', 'user')
    },
    {
      type: 'password',
      name: 'password',
      message: 'MySQL 密码:'
    },
    {
      type: 'input',
      name: 'database',
      message: 'MySQL 数据库名:',
      default: schemaDefault('mysql', 'database'),
      validate: (input: string) => {
        if (!input.trim()) return '数据库名不能为空';
        return true;
      }
    }
  ]);

  return {
    dialect: 'mysql',
    host: config.host,
    port: Number(config.port),
    user: config.user,
    password: config.password,
    database: config.database
  };
}

// PostgreSQL 配置
async function configurePostgreSQL(): Promise<DatabaseConfig> {
  const config = await inquirer.prompt([
    {
      type: 'input',
      name: 'host',
      message: 'PostgreSQL 主机地址:',
      default: schemaDefault('pg', 'host')
    },
    {
      type: 'input',
      name: 'port',
      message: 'PostgreSQL 端口:',
      default: String(schemaDefault('pg', 'port')),
      validate: (input: string) => {
        const value = parseIntegerInput(input, 1, 65535);
        return typeof value === 'number' ? true : value;
      }
    },
    {
      type: 'input',
      name: 'user',
      message: 'PostgreSQL 用户名:',
      default: schemaDefault('pg', 'user')
    },
    {
      type: 'password',
      name: 'password',
      message: 'PostgreSQL 密码:'
    },
    {
      type: 'input',
      name: 'database',
      message: 'PostgreSQL 数据库名:',
      default: schemaDefault('pg', 'database'),
      validate: (input: string) => {
        if (!input.trim()) return '数据库名不能为空';
        return true;
      }
    }
  ]);

  return {
    dialect: 'pg',
    host: config.host,
    port: Number(config.port),
    user: config.user,
    password: config.password,
    database: config.database
  };
}

// MongoDB 配置
async function configureMongoDB(): Promise<DatabaseConfig> {
  const { url, dbName } = await inquirer.prompt([
    {
      type: 'input',
      name: 'url',
      message: 'MongoDB 连接字符串:',
      default: schemaDefault('mongodb', 'url'),
      validate: (input: string) => {
        if (!input.trim()) return '连接字符串不能为空';
        if (!input.startsWith('mongodb://') && !input.startsWith('mongodb+srv://')) {
          return '请输入有效的 MongoDB 连接字符串';
        }
        return true;
      }
    },
    {
      type: 'input',
      name: 'dbName',
      message: 'MongoDB 数据库名:',
      default: schemaDefault('mongodb', 'dbName'),
      validate: (input: string) => {
        if (!input.trim()) return '数据库名不能为空';
        return true;
      }
    }
  ]);

  return {
    dialect: 'mongodb',
    url,
    dbName
  };
}

// Redis 配置
async function configureRedis(): Promise<DatabaseConfig> {
  const config = await inquirer.prompt([
    {
      type: 'input',
      name: 'host',
      message: 'Redis 主机地址:',
      default: schemaDefault('redis', 'socket', 'host')
    },
    {
      type: 'input',
      name: 'port',
      message: 'Redis 端口:',
      default: String(schemaDefault('redis', 'socket', 'port')),
      validate: (input: string) => {
        const value = parseIntegerInput(input, 1, 65535);
        return typeof value === 'number' ? true : value;
      }
    },
    {
      type: 'password',
      name: 'password',
      message: 'Redis 密码 (可选):'
    },
    {
      type: 'input',
      name: 'db',
      message: 'Redis 数据库索引:',
      default: String(schemaDefault('redis', 'database')),
      validate: (input: string) => {
        const value = parseIntegerInput(input, 0);
        return typeof value === 'number' ? true : '请输入有效的数据库索引 (>= 0)';
      }
    }
  ]);

  return {
    dialect: 'redis',
    socket: {
      host: config.host,
      port: Number(config.port)
    },
    password: config.password || undefined,
    database: Number(config.db)
  };
}
