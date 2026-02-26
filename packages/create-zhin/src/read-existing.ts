/**
 * 读取已有 Zhin 项目的配置与 .env，用于 in-place 重新配置时回显默认值
 */
import fs from 'fs-extra';
import path from 'path';
import yaml from 'yaml';
import type { InitOptions, DatabaseConfig } from './types.js';
import type { AdapterSetupResult } from './adapter.js';
import type { AISetupConfig } from './ai.js';

const CONFIG_CANDIDATES = ['zhin.config.yml', 'zhin.config.yaml', 'zhin.config.json'];

export interface ExistingProjectState {
  /** 从现有配置推断的 InitOptions 默认值 */
  options: Partial<InitOptions>;
  /** 现有 plugins 列表（用于 in-place 时保留） */
  existingPlugins: string[];
  /** 现有 bots 配置（用于 in-place 时保留） */
  existingBots: any[];
  /** 检测到的配置格式 */
  configFormat: 'yaml' | 'json' | 'toml';
  /** 配置文件路径 */
  configPath: string;
}

function parseEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    const unquoted = value.replace(/^["']|["']$/g, '');
    out[key] = unquoted;
  }
  return out;
}

function inferConfigFormat(configPath: string): 'yaml' | 'json' | 'toml' {
  const ext = path.extname(configPath).toLowerCase();
  if (ext === '.json') return 'json';
  if (ext === '.toml') return 'toml';
  return 'yaml';
}

function mapDatabaseFromConfig(db: any): DatabaseConfig | undefined {
  if (!db || !db.dialect) return undefined;
  return {
    dialect: db.dialect,
    filename: db.filename,
    mode: db.mode,
    host: db.host,
    port: db.port,
    user: db.user,
    password: db.password,
    database: db.database,
    url: db.url,
    dbName: db.dbName,
    socket: db.socket,
  } as DatabaseConfig;
}

function mapAIFromConfig(ai: any, env: Record<string, string>): AISetupConfig | undefined {
  if (!ai) return undefined;
  const enabled = ai.enabled !== false;
  if (!enabled) return { enabled: false };
  const defaultProvider = ai.defaultProvider;
  const providers: AISetupConfig['providers'] = {};
  if (ai.providers) {
    for (const [name, p] of Object.entries(ai.providers as Record<string, any>)) {
      if (!p) continue;
      providers[name] = {
        apiKey: p.apiKey,
        host: p.host,
        baseUrl: p.baseUrl,
        models: p.models,
      };
    }
  }
  return {
    enabled: true,
    defaultProvider,
    providers: Object.keys(providers).length ? providers : undefined,
    trigger: ai.trigger
      ? {
          respondToAt: ai.trigger.respondToAt !== false,
          respondToPrivate: ai.trigger.respondToPrivate !== false,
          prefixes: Array.isArray(ai.trigger.prefixes) ? ai.trigger.prefixes : ['#', 'AI:'],
        }
      : undefined,
  };
}

/**
 * 从现有项目目录读取配置与 .env，返回用于 in-place 的默认选项
 */
export async function readExistingProjectConfig(cwd: string): Promise<ExistingProjectState | null> {
  let configPath: string | null = null;
  for (const name of CONFIG_CANDIDATES) {
    const p = path.join(cwd, name);
    if (await fs.pathExists(p)) {
      configPath = p;
      break;
    }
  }
  if (!configPath) return null;

  const raw = await fs.readFile(configPath, 'utf-8');
  const ext = path.extname(configPath).toLowerCase();
  let config: any = {};
  if (ext === '.json') {
    try {
      config = JSON.parse(raw);
    } catch {
      return null;
    }
  } else {
    try {
      config = yaml.parse(raw);
    } catch {
      return null;
    }
  }

  const envPath = path.join(cwd, '.env');
  let env: Record<string, string> = {};
  if (await fs.pathExists(envPath)) {
    const envContent = await fs.readFile(envPath, 'utf-8');
    env = parseEnvFile(envContent);
  }

  const configFormat = inferConfigFormat(configPath);
  const existingPlugins = Array.isArray(config.plugins) ? config.plugins : [];
  const existingBots = Array.isArray(config.bots) ? config.bots : [];

  // 从 config.bots 和 config.plugins 推断 adapters（仅保留结构，env 从 .env 来）
  const adapterPlugins = existingPlugins.filter(
    (p: string) => typeof p === 'string' && p.startsWith('@zhin.js/adapter-'),
  );
  const envVars: Record<string, string> = { ...env };

  const options: Partial<InitOptions> = {
    config: configFormat,
    httpUsername: env.username || env.USER || '',
    httpPassword: env.password || env.PASSWORD || '',
    database: mapDatabaseFromConfig(config.database),
    ai: mapAIFromConfig(config.ai, env),
    adapters: {
      packages: adapterPlugins,
      plugins: adapterPlugins,
      bots: existingBots,
      envVars,
    } as AdapterSetupResult,
  };

  return {
    options,
    existingPlugins,
    existingBots,
    configFormat,
    configPath,
  };
}
