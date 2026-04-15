import fs from 'fs-extra';
import path from 'path';
import { InitOptions, DatabaseConfig } from './types.js';
import { generateAIConfigYaml, generateAIConfigJSON, generateAIConfigToml } from './ai.js';
import { generateBotsConfigYaml, generateBotsConfigJSON, generateBotsConfigToml } from './adapter.js';

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

// 数据库配置对象类型
type DatabaseConfigObject = {
  dialect: string;
  [key: string]: string | number | { [key: string]: string | number } | undefined;
};

// 生成数据库配置代码（仅支持 yaml / json / toml）
export function generateDatabaseConfig(config: DatabaseConfig, format: 'yaml' | 'json' | 'toml'): string {
  const useEnvRef = format === 'yaml' || format === 'toml';
  let configObj: DatabaseConfigObject = { dialect: config.dialect };

  switch (config.dialect) {
    case 'mysql':
      configObj = {
        dialect: 'mysql',
        host: useEnvRef ? '${DB_HOST}' : 'env.DB_HOST',
        port: useEnvRef ? '${DB_PORT}' : 'parseInt(env.DB_PORT || "3306")',
        user: useEnvRef ? '${DB_USER}' : 'env.DB_USER',
        password: useEnvRef ? '${DB_PASSWORD}' : 'env.DB_PASSWORD',
        database: useEnvRef ? '${DB_DATABASE}' : 'env.DB_DATABASE'
      };
      break;
    case 'pg':
      configObj = {
        dialect: 'pg',
        host: useEnvRef ? '${DB_HOST}' : 'env.DB_HOST',
        port: useEnvRef ? '${DB_PORT}' : 'parseInt(env.DB_PORT || "5432")',
        user: useEnvRef ? '${DB_USER}' : 'env.DB_USER',
        password: useEnvRef ? '${DB_PASSWORD}' : 'env.DB_PASSWORD',
        database: useEnvRef ? '${DB_DATABASE}' : 'env.DB_DATABASE'
      };
      break;
    case 'mongodb':
      configObj = {
        dialect: 'mongodb',
        url: useEnvRef ? '${DB_URL}' : 'env.DB_URL',
        dbName: useEnvRef ? '${DB_NAME}' : 'env.DB_NAME'
      };
      break;
    case 'redis':
      configObj = {
        dialect: 'redis',
        socket: {
          host: useEnvRef ? '${REDIS_HOST}' : 'env.REDIS_HOST',
          port: useEnvRef ? '${REDIS_PORT}' : 'parseInt(env.REDIS_PORT || "6379")'
        },
        password: useEnvRef ? '${REDIS_PASSWORD}' : 'env.REDIS_PASSWORD || undefined',
        database: useEnvRef ? '${REDIS_DB}' : 'parseInt(env.REDIS_DB || "0")'
      };
      break;
    case 'sqlite':
    default:
      configObj = config;
      break;
  }

  switch (format) {
    case 'yaml': {
      const yamlLines: string[] = [];
      Object.entries(configObj).forEach(([key, value]) => {
        if (typeof value === 'object' && value !== null) {
          yamlLines.push(`  ${key}:`);
          Object.entries(value).forEach(([subKey, subValue]) => {
            yamlLines.push(`    ${subKey}: ${subValue}`);
          });
        } else {
          yamlLines.push(`  ${key}: ${value}`);
        }
      });
      return yamlLines.join('\n');
    }
    case 'json': {
      const jsonStr = JSON.stringify(configObj, null, 2).replace(/^/gm, '  ');
      return `  "database": ${jsonStr},`;
    }
    case 'toml': {
      const tomlLines: string[] = ['', '[database]'];
      if (configObj.dialect === 'sqlite') {
        tomlLines.push(`dialect = "${configObj.dialect}"`);
        if ((configObj as any).filename) tomlLines.push(`filename = "${(configObj as any).filename}"`);
        if ((configObj as any).mode) tomlLines.push(`mode = "${(configObj as any).mode}"`);
      } else {
        tomlLines.push(`dialect = "${configObj.dialect}"`);
        Object.entries(configObj).forEach(([key, value]) => {
          if (key === 'dialect') return;
          if (typeof value === 'object' && value !== null) {
            tomlLines.push('', `[database.${key}]`);
            Object.entries(value).forEach(([k, v]) => tomlLines.push(`${k} = "${v}"`));
          } else {
            tomlLines.push(`${key} = "${value}"`);
          }
        });
      }
      return tomlLines.join('\n');
    }
    default:
      return '';
  }
}

// 构建 plugins 列表（根据用户选择的适配器）
function buildPluginsList(options: InitOptions): string[] {
  const plugins: string[] = ['example', '@zhin.js/http', '@zhin.js/console'];

  if (options.adapters?.plugins) {
    for (const plugin of options.adapters.plugins) {
      if (!plugins.includes(plugin)) {
        plugins.push(plugin);
      }
    }
  } else {
    // 默认只添加 sandbox
    if (!plugins.includes('@zhin.js/adapter-sandbox')) {
      plugins.push('@zhin.js/adapter-sandbox');
    }
  }

  return plugins;
}

// 创建配置文件（仅支持 yaml / json / toml）
export async function createConfigFile(appPath: string, format: string, options: InitOptions): Promise<void> {
  const configFormat = format as 'yaml' | 'json' | 'toml';
  const databaseConfig = options.database ? generateDatabaseConfig(options.database, configFormat) : '';
  const plugins = buildPluginsList(options);

  const botsYaml = options.adapters ? generateBotsConfigYaml(options.adapters) : '';
  const botsJSON = options.adapters ? generateBotsConfigJSON(options.adapters) : '';
  const botsToml = options.adapters ? generateBotsConfigToml(options.adapters) : '';
  const aiYaml = options.ai ? generateAIConfigYaml(options.ai) : '';
  const aiJSON = options.ai ? generateAIConfigJSON(options.ai) : '';
  const aiToml = options.ai ? generateAIConfigToml(options.ai) : '';

  const pluginsYamlLines = plugins.map(p => `  - "${p}"`).join('\n');
  const pluginsJsonLines = plugins.map(p => `    "${p}"`).join(',\n');
  const pluginsTomlLines = plugins.map(p => `  "${p}"`).join(',\n');

  let yamlExtraConfig = '';
  if (botsYaml) yamlExtraConfig += botsYaml;
  if (aiYaml) yamlExtraConfig += aiYaml;

  let jsonExtraConfig = '';
  if (botsJSON) jsonExtraConfig += `\n  ${botsJSON}`;
  if (aiJSON) jsonExtraConfig += `\n  ${aiJSON}`;

  let tomlExtraConfig = '';
  if (botsToml) tomlExtraConfig += botsToml;
  if (aiToml) tomlExtraConfig += aiToml;

  const configMap: Record<string, [string, string]> = {
    yaml: ['zhin.config.yml',
`log_level: 1
${databaseConfig ? `database:\n${databaseConfig}\n` : ''}plugin_dirs:
  - node_modules
  - ./src/plugins

services:
  - process
  - config
  - command
  - component
  - permission
  - cron

plugins:
${pluginsYamlLines}

http:
  port: 8086
  token: \${HTTP_TOKEN}
  base: /api

console:
  enabled: true
  lazyLoad: true
${yamlExtraConfig}
`],
    json: ['zhin.config.json',
`{
  "log_level": 1,
${databaseConfig ? `  ${databaseConfig}\n` : ''}  "plugin_dirs": [
    "node_modules",
    "./src/plugins"
  ],
  "services": [
    "process",
    "config",
    "command",
    "component",
    "permission",
    "cron"
  ],
  "plugins": [
${pluginsJsonLines}
  ],
  "http": {
    "port": 8086,
    "token": "\${HTTP_TOKEN}",
    "base": "/api"
  },
  "console": {
    "enabled": true,
    "lazyLoad": true
  }${jsonExtraConfig ? `,${jsonExtraConfig}` : ''}
}
`],
    toml: ['zhin.config.toml',
`log_level = 1
${databaseConfig}

plugin_dirs = [
  "node_modules",
  "./src/plugins"
]

services = [
  "process",
  "config",
  "command",
  "component",
  "permission",
  "cron"
]

plugins = [
${pluginsTomlLines}
]

[http]
port = 8086
token = "\${HTTP_TOKEN}"
base = "/api"

[console]
enabled = true
lazyLoad = true
${tomlExtraConfig}
`]
  };

  const [filename, content] = configMap[format] || configMap.yaml;
  await fs.writeFile(path.join(appPath, filename), content);
}