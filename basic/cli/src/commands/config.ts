import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import yaml from 'yaml';
import { formatCompact } from '@zhin.js/logger';
import { logger } from '../utils/logger.js';

function findConfigFile(cwd: string): string | null {
  const candidates = ['zhin.config.yml', 'zhin.config.yaml', 'zhin.config.json', 'zhin.config.toml', 'zhin.config.ts'];
  return candidates.find(f => fs.existsSync(path.join(cwd, f))) || null;
}

async function readConfig(filePath: string): Promise<any> {
  const ext = path.extname(filePath);
  const content = await fs.readFile(filePath, 'utf-8');

  if (ext === '.yml' || ext === '.yaml') {
    return yaml.parse(content);
  } else if (ext === '.json') {
    return JSON.parse(content);
  } else if (ext === '.ts') {
    // TODO: 支持 TypeScript 配置文件
    logger.warn(formatCompact( { cmd: 'config', op: 'unsupported_ts', hint: 'zhin build' }));
    return {};
  }
  return {};
}

async function saveConfig(filePath: string, config: any): Promise<void> {
  const ext = path.extname(filePath);

  if (ext === '.yml' || ext === '.yaml') {
    await fs.writeFile(filePath, yaml.stringify(config));
  } else if (ext === '.json') {
    await fs.writeFile(filePath, JSON.stringify(config, null, 2));
  } else if (ext === '.ts') {
    logger.error('不支持直接修改 TypeScript 配置文件，请手动编辑');
    process.exit(1);
  }
}

function getNestedValue(obj: any, keyPath: string): any {
  const keys = keyPath.split('.');
  let current = obj;
  
  for (const key of keys) {
    if (current && typeof current === 'object' && key in current) {
      current = current[key];
    } else {
      return undefined;
    }
  }
  
  return current;
}

function setNestedValue(obj: any, keyPath: string, value: any): void {
  const keys = keyPath.split('.');
  const lastKey = keys.pop()!;
  let current = obj;
  
  for (const key of keys) {
    if (!(key in current) || typeof current[key] !== 'object') {
      current[key] = {};
    }
    current = current[key];
  }
  
  current[lastKey] = value;
}

function parseValue(valueStr: string): any {
  // 尝试解析为 JSON
  try {
    return JSON.parse(valueStr);
  } catch {
    // 如果失败，返回字符串
    return valueStr;
  }
}

function formatValue(value: any, indent: number = 0): string {
  const prefix = '  '.repeat(indent);
  
  if (value === null) return chalk.gray('null');
  if (value === undefined) return chalk.gray('undefined');
  if (typeof value === 'boolean') return chalk.yellow(String(value));
  if (typeof value === 'number') return chalk.cyan(String(value));
  if (typeof value === 'string') return chalk.green(`"${value}"`);
  
  if (Array.isArray(value)) {
    if (value.length === 0) return chalk.gray('[]');
    return '[\n' + value.map(item => prefix + '  ' + formatValue(item, indent + 1)).join(',\n') + '\n' + prefix + ']';
  }
  
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return chalk.gray('{}');
    return '{\n' + entries.map(([k, v]) => 
      prefix + '  ' + chalk.blue(k) + ': ' + formatValue(v, indent + 1)
    ).join(',\n') + '\n' + prefix + '}';
  }
  
  return String(value);
}

const listCommand = new Command('list')
  .alias('ls')
  .description('显示所有配置')
  .action(async () => {
    const cwd = process.cwd();
    const configFile = findConfigFile(cwd);
    
    if (!configFile) {
      logger.error('未找到配置文件');
      process.exit(1);
    }
    
    const configPath = path.join(cwd, configFile);
    const config = await readConfig(configPath);
    
    console.log(chalk.bold(`\n📋 配置文件: ${configFile}\n`));
    console.log(formatValue(config));
    console.log('');
  });

const getCommand = new Command('get')
  .description('获取配置项的值')
  .argument('<key>', '配置键 (支持嵌套路径，如: ai.enabled)')
  .action(async (key: string) => {
    const cwd = process.cwd();
    const configFile = findConfigFile(cwd);
    
    if (!configFile) {
      logger.error('未找到配置文件');
      process.exit(1);
    }
    
    const configPath = path.join(cwd, configFile);
    const config = await readConfig(configPath);
    const value = getNestedValue(config, key);
    
    if (value === undefined) {
      logger.error(`配置项 "${key}" 不存在`);
      process.exit(1);
    }
    
    console.log(formatValue(value));
  });

const setCommand = new Command('set')
  .description('设置配置项的值')
  .argument('<key>', '配置键 (支持嵌套路径，如: ai.enabled)')
  .argument('<value>', '配置值 (支持 JSON 格式)')
  .action(async (key: string, valueStr: string) => {
    const cwd = process.cwd();
    const configFile = findConfigFile(cwd);
    
    if (!configFile) {
      logger.error('未找到配置文件');
      process.exit(1);
    }
    
    const configPath = path.join(cwd, configFile);
    const config = await readConfig(configPath);
    const value = parseValue(valueStr);
    
    setNestedValue(config, key, value);
    await saveConfig(configPath, config);
    
    console.log(chalk.green(`✓ 已设置 ${chalk.bold(key)} = ${formatValue(value)}`));
  });

const deleteCommand = new Command('delete')
  .alias('del')
  .description('删除配置项')
  .argument('<key>', '配置键 (支持嵌套路径)')
  .action(async (key: string) => {
    const cwd = process.cwd();
    const configFile = findConfigFile(cwd);
    
    if (!configFile) {
      logger.error('未找到配置文件');
      process.exit(1);
    }
    
    const configPath = path.join(cwd, configFile);
    const config = await readConfig(configPath);
    
    const keys = key.split('.');
    const lastKey = keys.pop()!;
    let current = config;
    
    for (const k of keys) {
      if (!(k in current) || typeof current[k] !== 'object') {
        logger.error(`配置项 "${key}" 不存在`);
        process.exit(1);
      }
      current = current[k];
    }
    
    if (!(lastKey in current)) {
      logger.error(`配置项 "${key}" 不存在`);
      process.exit(1);
    }
    
    delete current[lastKey];
    await saveConfig(configPath, config);
    
    console.log(chalk.green(`✓ 已删除 ${chalk.bold(key)}`));
  });

const pathCommand = new Command('path')
  .description('显示配置文件路径')
  .action(() => {
    const cwd = process.cwd();
    const configFile = findConfigFile(cwd);
    
    if (!configFile) {
      logger.error('未找到配置文件');
      process.exit(1);
    }
    
    console.log(path.join(cwd, configFile));
  });

export const configCommand = new Command('config')
  .description('管理配置文件')
  .addCommand(listCommand)
  .addCommand(getCommand)
  .addCommand(setCommand)
  .addCommand(deleteCommand)
  .addCommand(pathCommand);
