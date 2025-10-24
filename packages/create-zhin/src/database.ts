import inquirer from 'inquirer';
import { DatabaseConfig } from './types.js';

// 配置数据库选项
export async function configureDatabaseOptions(): Promise<DatabaseConfig> {
  const { dialect } = await inquirer.prompt([
    {
      type: 'list',
      name: 'dialect',
      message: '选择数据库类型:',
      choices: [
        { name: 'SQLite (推荐, 零配置)', value: 'sqlite' },
        { name: 'MySQL', value: 'mysql' },
        { name: 'PostgreSQL', value: 'pg' },
        { name: 'MongoDB', value: 'mongodb' },
        { name: 'Redis', value: 'redis' }
      ],
      default: 'sqlite'
    }
  ]);

  switch (dialect) {
    case 'sqlite':
      return await configureSQLite();
    case 'mysql':
      return await configureMySQL();
    case 'pg':
      return await configurePostgreSQL();
    case 'mongodb':
      return await configureMongoDB();
    case 'redis':
      return await configureRedis();
    default:
      throw new Error(`未支持的数据库类型: ${dialect}`);
  }
}

// SQLite 配置
async function configureSQLite(): Promise<DatabaseConfig> {
  const { filename, mode } = await inquirer.prompt([
    {
      type: 'input',
      name: 'filename',
      message: 'SQLite 数据库文件路径:',
      default: './data/bot.db',
      validate: (input: string) => {
        if (!input.trim()) return '文件路径不能为空';
        return true;
      }
    },
    {
      type: 'list',
      name: 'mode',
      message: 'SQLite 模式:',
      choices: [
        { name: 'WAL (推荐, 并发性能好)', value: 'wal' },
        { name: 'DELETE (默认)', value: 'delete' },
        { name: 'MEMORY (内存数据库)', value: 'memory' }
      ],
      default: 'wal'
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
      default: 'localhost'
    },
    {
      type: 'input',
      name: 'port',
      message: 'MySQL 端口:',
      default: '3306',
      validate: (input: string) => {
        const port = parseInt(input);
        if (isNaN(port) || port < 1 || port > 65535) {
          return '请输入有效的端口号 (1-65535)';
        }
        return true;
      }
    },
    {
      type: 'input',
      name: 'user',
      message: 'MySQL 用户名:',
      default: 'root'
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
      default: 'zhin_bot',
      validate: (input: string) => {
        if (!input.trim()) return '数据库名不能为空';
        return true;
      }
    }
  ]);

  return {
    dialect: 'mysql',
    host: config.host,
    port: parseInt(config.port),
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
      default: 'localhost'
    },
    {
      type: 'input',
      name: 'port',
      message: 'PostgreSQL 端口:',
      default: '5432',
      validate: (input: string) => {
        const port = parseInt(input);
        if (isNaN(port) || port < 1 || port > 65535) {
          return '请输入有效的端口号 (1-65535)';
        }
        return true;
      }
    },
    {
      type: 'input',
      name: 'user',
      message: 'PostgreSQL 用户名:',
      default: 'postgres'
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
      default: 'zhin_bot',
      validate: (input: string) => {
        if (!input.trim()) return '数据库名不能为空';
        return true;
      }
    }
  ]);

  return {
    dialect: 'pg',
    host: config.host,
    port: parseInt(config.port),
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
      default: 'mongodb://localhost:27017',
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
      default: 'zhin_bot',
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
      default: 'localhost'
    },
    {
      type: 'input',
      name: 'port',
      message: 'Redis 端口:',
      default: '6379',
      validate: (input: string) => {
        const port = parseInt(input);
        if (isNaN(port) || port < 1 || port > 65535) {
          return '请输入有效的端口号 (1-65535)';
        }
        return true;
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
      default: '0',
      validate: (input: string) => {
        const db = parseInt(input);
        if (isNaN(db) || db < 0) {
          return '请输入有效的数据库索引 (>= 0)';
        }
        return true;
      }
    }
  ]);

  return {
    dialect: 'redis',
    socket: {
      host: config.host,
      port: parseInt(config.port)
    },
    password: config.password || undefined,
    database: parseInt(config.db)
  };
}