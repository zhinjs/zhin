import fs from 'fs-extra';
import path from 'path';
import yaml from 'yaml';
import { stringify as stringifyToml } from 'smol-toml';
import type { AdapterSetupResult, AISetupConfig, DatabaseConfig, InitOptions } from './types.js';
import {
  collectAdapterPluginConfigs,
  collectAdapterPluginManifest,
  generateAdapterEnvVars,
  getAdapterDependencies,
} from './adapter.js';
import { generateAIEnvVars, materializeAIConfig } from './ai.js';
import { generateDatabaseEnvVars, mergeEnvText } from './env.js';
import { ensureDatabaseForAdapters, ensureDatabaseForAI, getAIDependencies } from './project-deps.js';
import { DEFAULT_CREATE_BOT_HTTP_PORT, ZHIN_STACK_VERSIONS } from './zhin-stack-deps.js';
import { packageToInstanceKey } from './project-config-plan.js';

export function applyDatabaseToConfig(config: Record<string, unknown>, database: DatabaseConfig): void {
  // 物化为可落盘对象：非 SQLite 连接参数引用 .env（${VAR}），明文密码不进配置文件
  config.database = materializeDatabaseConfig(database);
}

/** 将 legacy 数组形式 plugins 归一化为新 runtime 的 instanceKey 映射 */
export function normalizePluginsMap(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) {
    const map: Record<string, unknown> = {};
    for (const entry of value) {
      if (typeof entry !== 'string') continue;
      map[packageToInstanceKey(entry)] ??= {};
    }
    return map;
  }
  if (value && typeof value === 'object') {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}

export function applyAdaptersToConfig(config: Record<string, unknown>, result: AdapterSetupResult): void {
  const plugins = normalizePluginsMap(config.plugins);
  for (const instance of result.instances) {
    plugins[instance.instanceKey] = mergeAdapterInstanceConfig(
      instance.instanceKey,
      plugins[instance.instanceKey],
      instance.config,
    );
  }
  config.plugins = plugins;
  // legacy endpoints 列表不被 runtime 配置 schema 接受（additionalProperties: false）
  delete config.endpoints;
}

function endpointName(endpoint: unknown): string | undefined {
  if (!endpoint || typeof endpoint !== 'object' || Array.isArray(endpoint)) return undefined;
  const name = (endpoint as Record<string, unknown>).name;
  return typeof name === 'string' ? name : undefined;
}

/**
 * 重跑向导时按实例合并配置而非整体覆盖：保留现有 endpoints 中 name 不冲突的项
 * 与其他实例级键；被向导结果覆盖的 endpoints / 键在覆盖前打印提示。
 */
function mergeAdapterInstanceConfig(
  instanceKey: string,
  existing: unknown,
  next: Record<string, unknown>,
): Record<string, unknown> {
  if (!existing || typeof existing !== 'object' || Array.isArray(existing)) return next;
  const current = existing as Record<string, unknown>;
  const dropped: string[] = [];

  const merged: Record<string, unknown> = { ...current, ...next };

  const currentEndpoints = Array.isArray(current.endpoints) ? current.endpoints : [];
  const nextEndpoints = Array.isArray(next.endpoints) ? next.endpoints : [];
  if (currentEndpoints.length > 0 && nextEndpoints.length > 0) {
    const nextNames = new Set(nextEndpoints.map(endpointName));
    const kept = currentEndpoints.filter((endpoint) => {
      const name = endpointName(endpoint);
      if (name != null && nextNames.has(name)) {
        dropped.push(`endpoint "${name}"`);
        return false;
      }
      return true;
    });
    merged.endpoints = [...nextEndpoints, ...kept];
  }

  for (const key of Object.keys(next)) {
    if (key !== 'endpoints' && key in current) dropped.push(`键 "${key}"`);
  }

  if (dropped.length > 0) {
    console.warn(`[zhin setup] plugins.${instanceKey} 的 ${dropped.join('、')} 已被向导结果覆盖`);
  }
  return merged;
}

export function applyAIToConfig(config: Record<string, unknown>, ai: AISetupConfig): void {
  config.ai = materializeAIConfig(ai);
}

/** 把 zhin.plugins 清单条目合并进项目 package.json（zhin setup 路径） */
export async function mergePluginManifestIntoPackageJson(
  projectDir: string,
  entries: Array<{ package: string; instanceKey: string }>,
): Promise<boolean> {
  if (entries.length === 0) return false;
  const pkgPath = path.join(projectDir, 'package.json');
  if (!(await fs.pathExists(pkgPath))) return false;

  const pkg = await fs.readJson(pkgPath);
  const zhin = pkg.zhin && typeof pkg.zhin === 'object' && !Array.isArray(pkg.zhin)
    ? pkg.zhin
    : { protocol: 1, type: 'plugin', entry: './plugin.ts' };
  const manifest: Array<{ package: string; instanceKey: string }> = Array.isArray(zhin.plugins)
    ? [...zhin.plugins]
    : [];
  let changed = false;
  for (const entry of entries) {
    if (manifest.some((item) => item?.instanceKey === entry.instanceKey)) continue;
    manifest.push({ package: entry.package, instanceKey: entry.instanceKey });
    changed = true;
  }
  if (!changed && pkg.zhin) return false;
  zhin.plugins = manifest;
  pkg.zhin = zhin;
  await fs.writeJson(pkgPath, pkg, { spaces: 2 });
  return true;
}

export async function appendWizardEnvVars(
  projectDir: string,
  adapters?: AdapterSetupResult,
  ai?: AISetupConfig,
  database?: DatabaseConfig,
): Promise<void> {
  const extra =
    (database ? generateDatabaseEnvVars(database) : '') +
    (adapters ? generateAdapterEnvVars(adapters) : '') +
    (ai ? generateAIEnvVars(ai) : '');
  if (extra.trim()) {
    const envPath = path.join(projectDir, '.env');
    const existing = (await fs.pathExists(envPath)) ? await fs.readFile(envPath, 'utf-8') : '';
    // 按 KEY 覆盖而非追加：重复运行向导幂等，不产生重复行
    await fs.writeFile(envPath, mergeEnvText(existing, extra));
  }

  // 新 Plugin Runtime 通过 package.json zhin.plugins 清单挂载子插件，与依赖一起落盘
  if (adapters) {
    await mergePluginManifestIntoPackageJson(projectDir, collectAdapterPluginManifest(adapters));
  }
}

export function collectWizardDependencies(
  options: Pick<InitOptions, 'adapters' | 'ai'>,
): Record<string, string> {
  return {
    ...(options.adapters ? getAdapterDependencies(options.adapters) : {}),
    ...getAIDependencies(options.ai),
    // tools/ 约定需要 @zhin.js/tool（与 create-zhin 路径对齐）
    ...(options.ai?.enabled ? { '@zhin.js/tool': ZHIN_STACK_VERSIONS['@zhin.js/tool'] } : {}),
  };
}

/** 向导结果需要合并进 package.json zhin.features 的条目（与 create-zhin 路径对齐） */
export function collectWizardFeatures(
  options: Pick<InitOptions, 'ai'>,
): Array<{ package: string; api: string }> {
  return options.ai?.enabled ? [{ package: '@zhin.js/tool', api: '^1.0.0' }] : [];
}

/** 把 features 清单条目合并进项目 package.json 的 zhin.features（zhin setup 路径） */
export async function mergeFeaturesIntoPackageJson(
  projectDir: string,
  entries: Array<{ package: string; api: string }>,
): Promise<boolean> {
  if (entries.length === 0) return false;
  const pkgPath = path.join(projectDir, 'package.json');
  if (!(await fs.pathExists(pkgPath))) return false;

  const pkg = await fs.readJson(pkgPath);
  const zhin = pkg.zhin && typeof pkg.zhin === 'object' && !Array.isArray(pkg.zhin)
    ? pkg.zhin
    : { protocol: 1, type: 'plugin', entry: './plugin.ts' };
  const features: Array<{ package: string; api?: string }> = Array.isArray(zhin.features)
    ? [...zhin.features]
    : [];
  let changed = false;
  for (const entry of entries) {
    if (features.some((item) => item?.package === entry.package)) continue;
    features.push(entry);
    changed = true;
  }
  if (!changed && pkg.zhin) return false;
  zhin.features = features;
  pkg.zhin = zhin;
  await fs.writeJson(pkgPath, pkg, { spaces: 2 });
  return true;
}

export async function mergeDependenciesIntoPackageJson(
  projectDir: string,
  deps: Record<string, string>,
): Promise<boolean> {
  if (Object.keys(deps).length === 0) return false;
  const pkgPath = path.join(projectDir, 'package.json');
  if (!(await fs.pathExists(pkgPath))) return false;

  const pkg = await fs.readJson(pkgPath);
  pkg.dependencies = pkg.dependencies ?? {};
  let changed = false;
  for (const [name, version] of Object.entries(deps)) {
    if (pkg.dependencies[name] === version) continue;
    pkg.dependencies[name] = version;
    changed = true;
  }
  if (changed) {
    await fs.writeJson(pkgPath, pkg, { spaces: 2 });
  }
  return changed;
}

/** 交互向导结果写入 InitOptions 并补全 database 等前置条件 */
export function finalizeWizardOptions(options: InitOptions): void {
  ensureDatabaseForAI(options);
  ensureDatabaseForAdapters(options);
}

/** 将 InitOptions 中的 wizard 结果合并进已有 zhin 配置对象 */
export function applyWizardOptionsToConfig(config: Record<string, unknown>, options: InitOptions): void {
  if (options.database) applyDatabaseToConfig(config, options.database);
  if (options.adapters) applyAdaptersToConfig(config, options.adapters);
  if (options.ai?.enabled) applyAIToConfig(config, options.ai);
}

/**
 * 数据库配置物化为可落盘对象；非 SQLite 连接参数引用 .env（${VAR} 由 runtime 展开）
 */
export function materializeDatabaseConfig(config: DatabaseConfig): Record<string, unknown> {
  switch (config.dialect) {
    case 'mysql':
      return {
        dialect: 'mysql',
        host: '${DB_HOST}',
        port: '${DB_PORT}',
        user: '${DB_USER}',
        password: '${DB_PASSWORD}',
        database: '${DB_DATABASE}',
      };
    case 'pg':
      return {
        dialect: 'pg',
        host: '${DB_HOST}',
        port: '${DB_PORT}',
        user: '${DB_USER}',
        password: '${DB_PASSWORD}',
        database: '${DB_DATABASE}',
      };
    case 'mongodb':
      return { dialect: 'mongodb', url: '${DB_URL}', dbName: '${DB_NAME}' };
    case 'redis':
      return {
        dialect: 'redis',
        socket: { host: '${REDIS_HOST}', port: '${REDIS_PORT}' },
        password: '${REDIS_PASSWORD}',
        database: '${REDIS_DB}',
      };
    case 'sqlite':
    default: {
      const sqlite: Record<string, unknown> = { dialect: 'sqlite' };
      if (config.filename) sqlite.filename = config.filename;
      if (config.mode) sqlite.mode = config.mode;
      return sqlite;
    }
  }
}

/** 生活助手模板的额外 AI 配置（知识库 + compaction + 执行审批） */
function applyLifeAssistantAiExtras(ai: Record<string, unknown>): Record<string, unknown> {
  const agent = ai.agent && typeof ai.agent === 'object' && !Array.isArray(ai.agent)
    ? { ...(ai.agent as Record<string, unknown>) }
    : {};
  return {
    ...ai,
    knowledge: { baseDir: 'knowledge' },
    agent: {
      ...agent,
      execSecurity: 'allowlist',
      execApprovalMode: 'ask',
      compaction: { enabled: true, auto: true, keepRecentTokens: 20000 },
    },
  };
}

/**
 * 构建新 Plugin Runtime 配置文档（顶层 http/database/ai + plugins.<instanceKey>）。
 * 顶层键与 packages/im/runtime/src/config-composer.ts 的 effectiveSchema 对齐。
 */
export function buildRuntimeConfigDocument(options: InitOptions): Record<string, unknown> {
  const doc: Record<string, unknown> = {};

  if (options.database) {
    doc.database = materializeDatabaseConfig(options.database);
  }

  doc.http = {
    token: '${HTTP_TOKEN}',
    port: DEFAULT_CREATE_BOT_HTTP_PORT,
    base: '/api',
    corsOrigins: ['https://console.zhin.dev'],
  };

  if (options.ai?.enabled) {
    const ai = materializeAIConfig(options.ai);
    doc.ai = options.template === 'life-assistant' ? applyLifeAssistantAiExtras(ai) : ai;
  }

  doc.plugins = options.adapters ? collectAdapterPluginConfigs(options.adapters) : {};

  return doc;
}

/** 序列化配置文档为 zhin.config.yml / json / toml 文本 */
export function serializeRuntimeConfig(
  doc: Record<string, unknown>,
  format: 'yaml' | 'json' | 'toml',
): string {
  if (format === 'json') return `${JSON.stringify(doc, null, 2)}\n`;
  if (format === 'toml') return stringifyToml(doc);
  return yaml.stringify(doc);
}
