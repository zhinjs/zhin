import fs from 'fs-extra';
import path from 'path';
import { InitOptions, DatabaseConfig } from './types.js';

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

// 生成数据库配置代码
export function generateDatabaseConfig(config: DatabaseConfig, format: 'ts' | 'js' | 'yaml' | 'json'): string {
  // 根据数据库类型生成使用环境变量的配置
  let configObj: any = { dialect: config.dialect };
  
  switch (config.dialect) {
    case 'mysql':
      configObj = {
        dialect: 'mysql',
        host: format === 'yaml' ? '${DB_HOST}' : 'env.DB_HOST',
        port: format === 'yaml' ? '${DB_PORT}' : 'parseInt(env.DB_PORT || "3306")',
        user: format === 'yaml' ? '${DB_USER}' : 'env.DB_USER',
        password: format === 'yaml' ? '${DB_PASSWORD}' : 'env.DB_PASSWORD',
        database: format === 'yaml' ? '${DB_DATABASE}' : 'env.DB_DATABASE'
      };
      break;
    case 'pg':
      configObj = {
        dialect: 'pg',
        host: format === 'yaml' ? '${DB_HOST}' : 'env.DB_HOST',
        port: format === 'yaml' ? '${DB_PORT}' : 'parseInt(env.DB_PORT || "5432")',
        user: format === 'yaml' ? '${DB_USER}' : 'env.DB_USER',
        password: format === 'yaml' ? '${DB_PASSWORD}' : 'env.DB_PASSWORD',
        database: format === 'yaml' ? '${DB_DATABASE}' : 'env.DB_DATABASE'
      };
      break;
    case 'mongodb':
      configObj = {
        dialect: 'mongodb',
        url: format === 'yaml' ? '${DB_URL}' : 'env.DB_URL',
        dbName: format === 'yaml' ? '${DB_NAME}' : 'env.DB_NAME'
      };
      break;
    case 'redis':
      configObj = {
        dialect: 'redis',
        socket: {
          host: format === 'yaml' ? '${REDIS_HOST}' : 'env.REDIS_HOST',
          port: format === 'yaml' ? '${REDIS_PORT}' : 'parseInt(env.REDIS_PORT || "6379")'
        },
        password: format === 'yaml' ? '${REDIS_PASSWORD}' : 'env.REDIS_PASSWORD || undefined',
        database: format === 'yaml' ? '${REDIS_DB}' : 'parseInt(env.REDIS_DB || "0")'
      };
      break;
    case 'sqlite':
    default:
      configObj = config;
      break;
  }
  
  switch (format) {
    case 'ts':
    case 'js':
      if (config.dialect === 'sqlite') {
        return `database: ${JSON.stringify(configObj, null, 2).replace(/^/gm, '    ').trim()},`;
      } else {
        // 对于其他数据库，手动构建配置以保持可读性
        let configLines: string[] = ['{'];
        configLines.push(`      dialect: '${configObj.dialect}',`);
        
        Object.entries(configObj).forEach(([key, value]) => {
          if (key === 'dialect') return;
          
          if (typeof value === 'object' && value !== null) {
            configLines.push(`      ${key}: {`);
            Object.entries(value).forEach(([subKey, subValue]) => {
              if (typeof subValue === 'string' && subValue.startsWith('env.')) {
                configLines.push(`        ${subKey}: ${subValue},`);
              } else if (typeof subValue === 'string' && subValue.includes('parseInt(')) {
                configLines.push(`        ${subKey}: ${subValue},`);
              } else {
                configLines.push(`        ${subKey}: '${subValue}',`);
              }
            });
            configLines.push('      },');
          } else if (typeof value === 'string' && value.startsWith('env.')) {
            configLines.push(`      ${key}: ${value},`);
          } else if (typeof value === 'string' && value.includes('parseInt(')) {
            configLines.push(`      ${key}: ${value},`);
          } else {
            configLines.push(`      ${key}: '${value}',`);
          }
        });
        configLines.push('    }');
        
        return `database: ${configLines.join('\n    ')},`;
      }
    case 'yaml':
      return Object.entries(configObj)
        .map(([key, value]) => `  ${key}: ${typeof value === 'object' ? JSON.stringify(value).replace(/"/g, '') : value}`)
        .join('\n');
    case 'json':
      const jsonStr = JSON.stringify(configObj, null, 2).replace(/^/gm, '  ');
      return `  "database": ${jsonStr},`;
    default:
      return '';
  }
}

// 创建配置文件
export async function createConfigFile(appPath: string, format: string, options: InitOptions) {
  const databaseConfig = options.database ? generateDatabaseConfig(options.database, format as any) : '';
  
  const configMap: Record<string, [string, string]> = {
    ts: ['zhin.config.ts', 
`import { defineConfig, LogLevel } from 'zhin.js';

export default defineConfig(async (env) => {
  return {
${databaseConfig ? `    ${databaseConfig.replace(/^    /, '')}` : ''}
    bots: [{
      name: \`\${process.pid}\`,
      context: 'process'
    }],
    log_level: LogLevel.INFO,
    log: {
      maxDays: 7,
      maxRecords: 10000,
      cleanupInterval: 24
    },
    plugin_dirs: [
      env.PLUGIN_DIR || './src/plugins',
      'node_modules',
      'node_modules/@zhin.js'
    ],
    plugins: [
      'adapter-process',
      'http',
      'console',
      'example'
    ],
    http: {
      port: 8086,
      username: env.HTTP_USERNAME,
      password: env.HTTP_PASSWORD,
      base: '/api'
    },
    debug: env.DEBUG === 'true'
  };
});
`],
    js: ['zhin.config.js',
`import { defineConfig, LogLevel } from 'zhin.js';

export default defineConfig(async (env) => {
  return {
${databaseConfig ? `    ${databaseConfig.replace(/^    /, '')}` : ''}
    bots: [{
      name: \`\${process.pid}\`,
      context: 'process'
    }],
    log_level: LogLevel.INFO,
    log: {
      maxDays: 7,
      maxRecords: 10000,
      cleanupInterval: 24
    },
    plugin_dirs: [
      env.PLUGIN_DIR || './src/plugins',
      'node_modules',
      'node_modules/@zhin.js'
    ],
    plugins: [
      'adapter-process',
      'http',
      'console',
      'example'
    ],
    http: {
      port: 8086,
      username: env.HTTP_USERNAME,
      password: env.HTTP_PASSWORD,
      base: '/api'
    },
    debug: env.DEBUG === 'true'
  };
});
`],
    yaml: ['zhin.config.yml',
`${databaseConfig ? `database:\n${databaseConfig}\n\n` : ''}bots:
  - name: \${process.pid}
    context: process

log_level: 1
log:
  maxDays: 7
  maxRecords: 10000
  cleanupInterval: 24

plugin_dirs:
  - ./src/plugins
  - node_modules
  - node_modules/@zhin.js

plugins:
  - adapter-process
  - http
  - console
  - example

http:
  port: 8086
  username: \${HTTP_USERNAME}
  password: \${HTTP_PASSWORD}
  base: /api

debug: false
`],
    json: ['zhin.config.json',
`{
${databaseConfig ? `${databaseConfig}` : ''}
  "bots": [{
    "name": "\${process.pid}",
    "context": "process"
  }],
  "log_level": 1,
  "log": {
    "maxDays": 7,
    "maxRecords": 10000,
    "cleanupInterval": 24
  },
  "plugin_dirs": [
    "./src/plugins",
    "node_modules",
    "node_modules/@zhin.js"
  ],
  "plugins": [
    "adapter-process",
    "http",
    "console",
    "example"
  ],
  "http": {
    "port": 8086,
    "username": "\${HTTP_USERNAME}",
    "password": "\${HTTP_PASSWORD}",
    "base": "/api"
  },
  "debug": false
}
`]
  };
  
  const [filename, content] = configMap[format] || configMap.ts;
  await fs.writeFile(path.join(appPath, filename), content);
}