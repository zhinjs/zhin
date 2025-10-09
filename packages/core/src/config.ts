import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { parse as parseToml } from 'toml';
import { config as loadDotenv } from 'dotenv';
import type {AppConfig, DefineConfig} from './types.js';

export interface ConfigOptions {
  configPath?: string;
  envPath?: string;
  envOverride?: boolean;
}

/**
 * 支持的配置文件格式
 */
export type ConfigFormat = 'json' | 'yaml' | 'yml' | 'toml' | 'js' | 'ts';

/**
 * 环境变量替换正则表达式，支持默认值语法: ${VAR_NAME:-default_value}
 */
const ENV_VAR_REGEX = /\$\{([^}]+)\}/g;

/**
 * 替换字符串中的环境变量
 */
function replaceEnvVars(str: string): string {
  return str.replace(ENV_VAR_REGEX, (match, content) => {
    // 解析环境变量名和默认值
    const colonIndex = content.indexOf(':-');
    let envName: string;
    let defaultValue: string | undefined;
    
    if (colonIndex !== -1) {
      // 格式: VAR_NAME:-default_value
      envName = content.slice(0, colonIndex);
      defaultValue = content.slice(colonIndex + 2);
    } else {
      // 格式: VAR_NAME
      envName = content;
      defaultValue = undefined;
    }
    
    const envValue = process.env[envName];
    
    if (envValue !== undefined) {
      return envValue;
    } else if (defaultValue !== undefined) {
      return defaultValue;
    } else {
      // console.warn 已替换为注释
      return match;
    }
  });
}

/**
 * 递归替换对象中的环境变量
 */
function replaceEnvVarsInObject(obj: any): any {
  if (typeof obj === 'string') {
    return replaceEnvVars(obj);
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => replaceEnvVarsInObject(item));
  }
  
  if (obj && typeof obj === 'object') {
    for (const [key, value] of Object.entries(obj)) {
      obj[key] = replaceEnvVarsInObject(value);
    }
    return obj;
  }
  
  return obj;
}

/**
 * 根据文件扩展名解析配置文件
 */
async function parseConfigFile(content: string, format: ConfigFormat, filePath?: string): Promise<any> {
  try {
    switch (format) {
      case 'json':
        return JSON.parse(content);
      case 'yaml':
      case 'yml':
        return parseYaml(content);
      case 'toml':
        return parseToml(content);
      case 'js':
      case 'ts':
        if (!filePath) {
          throw new Error('解析 JS/TS 配置文件需要提供文件路径');
        }
        // 使用动态导入加载 JS/TS 模块
        const fileUrl = pathToFileURL(path.resolve(filePath)).href;
        const module = await import(fileUrl);
        // 支持 ES 模块的 default 导出和 CommonJS 模块
        const result = module.default || module;
        if(typeof result === 'function') return await result((process.env||{}) as Record<string,string>);
        return result;
      default:
        throw new Error(`不支持的配置文件格式: ${format}`);
    }
  } catch (error) {
    throw new Error(`解析配置文件失败: ${error}`);
  }
}

/**
 * 获取配置文件格式
 */
function getConfigFormat(filePath: string): ConfigFormat {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  if (!['json', 'yaml', 'yml', 'toml', 'js', 'ts'].includes(ext)) {
    throw new Error(`不支持的配置文件格式: ${ext}`);
  }
  return ext as ConfigFormat;
}

/**
 * 查找配置文件
 */
function findConfigFile(cwd: string = process.cwd()): string | null {
  const configNames = [
    // 优先查找 zhin.config.* 格式
    'zhin.config.yaml',
    'zhin.config.yml', 
    'zhin.config.json',
    'zhin.config.toml',
    'zhin.config.ts',
    'zhin.config.ts',
    // 然后查找 config.* 格式
    'config.yaml',
    'config.yml',
    'config.json',
    'config.toml',
    'config.js',
    'config.ts'
  ];

  for (const name of configNames) {
    const filePath = path.join(cwd, name);
    if (fs.existsSync(filePath)) {
      return filePath;
    }
  }

  return null;
}
export function defineConfig<T extends DefineConfig<AppConfig>>(config: T): T {
  return config;
}
/**
 * 加载配置文件
 */
export async function loadConfig(options: ConfigOptions = {}): Promise<[string,AppConfig]> {
  const { configPath, envPath, envOverride = true } = options;
  
  // 加载环境变量
  if (envPath) {
    loadDotenv({ path: envPath, override: envOverride });
  } else {
    // 尝试加载默认的 .env 文件
    const defaultEnvPath = path.join(process.cwd(), '.env');
    if (fs.existsSync(defaultEnvPath)) {
      loadDotenv({ path: defaultEnvPath, override: envOverride });
    }
  }

  // 确定配置文件路径
  let finalConfigPath: string;
  
  if (configPath) {
    if (!fs.existsSync(configPath)) {
      throw new Error(`配置文件不存在: ${configPath}`);
    }
    finalConfigPath = configPath;
  } else {
    const foundPath = findConfigFile();
    if (!foundPath) {
      throw new Error('未找到配置文件，支持的文件名: zhin.config.[yaml|yml|json|toml|js|ts] 或 config.[yaml|yml|json|toml|js|ts]');
    }
    finalConfigPath = foundPath;
  }

  // 读取并解析配置文件
  const format = getConfigFormat(finalConfigPath);
  let rawConfig: any;
  
  if (format === 'js' || format === 'ts') {
    // JS/TS 文件不需要读取内容，直接解析
    rawConfig = await parseConfigFile('', format, finalConfigPath);
  } else {
    const content = fs.readFileSync(finalConfigPath, 'utf-8');
    rawConfig = await parseConfigFile(content, format, finalConfigPath);
  }
  
  // 替换环境变量
  const config = replaceEnvVarsInObject(rawConfig) as AppConfig;
  
  // 验证配置
  validateConfig(config);
  
  return [finalConfigPath,config];
}

/**
 * 验证配置文件结构
 */
function validateConfig(config: any): void {
  if (!config) {
    throw new Error('配置文件不能为空');
  }
  
  if (!config.bots || !Array.isArray(config.bots)) {
    throw new Error('配置文件必须包含 bots 数组');
  }
  
  
  for (const [index, bot] of config.bots.entries()) {
    if (!bot.name) {
      throw new Error(`机器人 ${index} 缺少 name 字段`);
    }
    
    if (!bot.context) {
      throw new Error(`机器人 ${bot.name} 缺少 context 字段`);
    }
  }
}

/**
 * 保存配置文件
 */
export function saveConfig(config: AppConfig, filePath: string): void {
  const format = getConfigFormat(filePath);
  let content: string;
  
  switch (format) {
    case 'json':
      content = JSON.stringify(config, null, 2);
      break;
    case 'yaml':
    case 'yml':
      content = stringifyYaml(config, { indent: 2 });
      break;
    case 'toml':
      // toml 库没有 stringify 方法，我们需要手动实现或使用其他库
      throw new Error('暂不支持保存 TOML 格式的配置文件');
    default:
      throw new Error(`不支持的配置文件格式: ${format}`);
  }
  
  fs.writeFileSync(filePath, content, 'utf-8');
}

/**
 * 创建默认配置
 */
export function createDefaultConfig(format: ConfigFormat = 'yaml'): AppConfig {
  return {
    bots: [],
    plugin_dirs: ['./src/plugins', 'node_modules'],
    plugins: [],
  };
} 