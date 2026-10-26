import { wizardText } from './messages.js';
import fs from 'fs-extra';
import path from 'path';
import yaml from 'yaml';
import { isLocale, readPluginConfigurationMap } from '@zhin.js/plugin-runtime';
import { readApplicationPluginDeclaration } from '@zhin.js/runtime';
import type { AdapterSetupResult, AISetupConfig, DatabaseConfig, InitOptions } from './types.js';
import {
  collectAdapterPluginManifest,
  generateAdapterEnvVars,
  getAdapterDependencies,
} from './adapter.js';
import { generateAIEnvVars, materializeAIConfig } from './ai.js';
import { generateDatabaseEnvVars, mergeEnvText } from './env.js';
import { getDatabaseDialectDefinition } from './database-definitions.js';
import { ensureDatabaseForAdapters, ensureDatabaseForAI, getAIDependencies } from './project-deps.js';
import { DEFAULT_CREATE_BOT_HTTP_PORT, ZHIN_STACK_VERSIONS } from './zhin-stack-deps.js';
import { withScaffoldVersionRanges } from './stack-version-ranges.js';

export function applyDatabaseToConfig(config: Record<string, unknown>, database: DatabaseConfig): void {
  // 物化为可落盘对象：非 SQLite 连接参数引用 .env（${VAR}），明文密码不进配置文件
  config.database = materializeDatabaseConfig(database);
}

/** Returns a mutable copy of the canonical Plugin instance configuration map. */
export function clonePluginConfigurationMap(
  config: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return { ...readPluginConfigurationMap(config) };
}

export function applyAdaptersToConfig(config: Record<string, unknown>, result: AdapterSetupResult, locale: 'zh-CN' | 'en' = 'zh-CN'): void {
  for (const instance of result.instances) {
    const plugins = clonePluginConfigurationMap(config);
    setPluginInstanceConfig(config, instance, mergeAdapterInstanceConfig(
      instance.instanceKey, plugins[instance.instanceKey], instance.config, locale
    ));
  }
  if (result.instances.length === 0) clonePluginConfigurationMap(config);
}

/** Writes one instance using the document's explicitly selected protocol. */
export function setPluginInstanceConfig(
  config: Record<string, unknown>,
  instance: { instanceKey: string; package: string },
  value: Record<string, unknown>,
): void {
  const declaration = readApplicationPluginDeclaration(config);
  const existing = declaration.instances.find(item => item.instanceKey === instance.instanceKey);
  if (existing && existing.package !== instance.package) {
    throw new Error(`Plugin instance ${instance.instanceKey} already belongs to ${existing.package}`);
  }
  const next = {
    ...config,
    plugins: { ...(config.plugins as Record<string, string> | undefined), [instance.instanceKey]: instance.package },
    [instance.instanceKey]: value,
  };
  readApplicationPluginDeclaration(next);
  config.plugins = next.plugins;
  config[instance.instanceKey] = value;
}

function endpointId(endpoint: unknown): string | undefined {
  if (!endpoint || typeof endpoint !== 'object' || Array.isArray(endpoint)) return undefined;
  const id = (endpoint as Record<string, unknown>).id;
  return typeof id === 'string' ? id : undefined;
}

/**
 * 重跑向导时按实例合并配置而非整体覆盖：保留现有 endpoints 中 id 不冲突的项
 * 与其他实例级键；被向导结果覆盖的 endpoints / 键在覆盖前打印提示。
 */
function mergeAdapterInstanceConfig(
  instanceKey: string,
  existing: unknown,
  next: Record<string, unknown>,
  locale: 'zh-CN' | 'en' = 'zh-CN'
): Record<string, unknown> {
  if (!existing || typeof existing !== 'object' || Array.isArray(existing)) return next;
  const current = existing as Record<string, unknown>;
  const dropped: string[] = [];

  const merged: Record<string, unknown> = { ...current, ...next };

  const currentEndpoints = Array.isArray(current.endpoints) ? current.endpoints : [];
  const nextEndpoints = Array.isArray(next.endpoints) ? next.endpoints : [];
  if (currentEndpoints.length > 0 && nextEndpoints.length > 0) {
    const nextNames = new Set(nextEndpoints.map(endpointId));
    const kept = currentEndpoints.filter((endpoint) => {
      const name = endpointId(endpoint);
      if (name != null && nextNames.has(name)) {
        dropped.push(`endpoint "${name}"`);
        return false;
      }
      return true;
    });
    merged.endpoints = [...nextEndpoints, ...kept];
  }

  for (const key of Object.keys(next)) {
    if (key !== 'endpoints' && key in current) dropped.push(wizardText(locale, "键 \"{v0}\"", [key]));
  }

  if (dropped.length > 0) {
    console.warn(wizardText(locale, "[zhin setup] plugins.{v0} 的 {v1} 已被向导结果覆盖", [instanceKey, dropped.join('、')]));
  }
  return merged;
}

export function applyAIToConfig(config: Record<string, unknown>, ai: AISetupConfig): void {
  config.ai = materializeAIConfig(ai);
}

export async function appendWizardEnvVars(
  projectDir: string,
  adapters?: AdapterSetupResult,
  ai?: AISetupConfig,
  database?: DatabaseConfig,
  locale: 'zh-CN' | 'en' = 'zh-CN'
): Promise<void> {
  const extra =
    (database ? generateDatabaseEnvVars(database, locale) : '') +
    (adapters ? generateAdapterEnvVars(adapters, locale) : '') +
    (ai ? generateAIEnvVars(ai, locale) : '');
  if (extra.trim()) {
    const envPath = path.join(projectDir, '.env');
    const existing = (await fs.pathExists(envPath)) ? await fs.readFile(envPath, 'utf-8') : '';
    // 按 KEY 覆盖而非追加：重复运行向导幂等，不产生重复行
    await fs.writeFile(envPath, mergeEnvText(existing, extra));
  }


}

export function collectWizardDependencies(
  options: Pick<InitOptions, 'adapters' | 'ai' | 'database'>,
): Record<string, string> {
  const databaseDriver = options.database
    ? getDatabaseDialectDefinition(options.database.dialect)?.driver
    : undefined;
  return withScaffoldVersionRanges({
    ...(options.adapters ? getAdapterDependencies(options.adapters) : {}),
    ...(databaseDriver ? { [databaseDriver.package]: databaseDriver.version } : {}),
    ...getAIDependencies(options.ai),
    // AI authoring conventions（与 create-zhin 路径对齐）
    ...(options.ai?.enabled ? {
      '@zhin.js/tool': ZHIN_STACK_VERSIONS['@zhin.js/tool'],
      '@zhin.js/prompt-section': ZHIN_STACK_VERSIONS['@zhin.js/prompt-section'],
    } : {}),
  });
}

/** 向导结果需要合并进 package.json zhin.features 的条目（与 create-zhin 路径对齐） */
export function collectWizardFeatures(
  options: Pick<InitOptions, 'ai'>,
): Array<{ package: string; api: string }> {
  return options.ai?.enabled ? [
    { package: '@zhin.js/tool', api: '^1.0.0' },
    { package: '@zhin.js/prompt-section', api: '^1.0.0' },
  ] : [];
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
export function applyWizardOptionsToConfig(config: Record<string, unknown>, options: InitOptions, locale: 'zh-CN' | 'en' = options.locale ?? 'zh-CN'): void {
  if (options.locale !== undefined) {
    if (!isLocale(options.locale)) throw new TypeError('Unsupported project locale');
    config.locale = options.locale;
  }
  if (options.database) applyDatabaseToConfig(config, options.database);
  if (options.adapters) applyAdaptersToConfig(config, options.adapters, locale);
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
    case 'memory':
      return { dialect: 'memory' };
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
 * 构建 v2 扁平主配置（plugins 包映射 + 顶层实例业务配置）。
 * 顶层键与 packages/im/runtime/src/config-composer.ts 的 effectiveSchema 对齐。
 */
export function buildRuntimeConfigDocument(options: InitOptions): Record<string, unknown> {
  const locale = options.locale;
  const doc: Record<string, unknown> = { configVersion: 2, plugins: {} };
  if (options.locale !== undefined) {
    if (!isLocale(options.locale)) throw new TypeError('Unsupported project locale');
    doc.locale = options.locale;
  }

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

  if (options.adapters) applyAdaptersToConfig(doc, options.adapters, locale);

  return doc;
}

/** Serialize a Root Runtime YAML or JSON configuration document. */
export function serializeRuntimeConfig(
  doc: Record<string, unknown>,
  format: 'yaml' | 'json',
): string {
  if (format === 'json') return `${JSON.stringify(doc, null, 2)}\n`;
  return yaml.stringify(doc);
}
