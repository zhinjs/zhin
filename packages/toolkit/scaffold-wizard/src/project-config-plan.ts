import fs from 'fs-extra';
import path from 'node:path';
import yaml from 'yaml';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import { providerSdkFor } from './ai.js';

const CONSOLE_URL = 'https://console.zhin.dev';
const CONFIG_CANDIDATES = [
  'zhin.config.yml',
  'zhin.config.yaml',
  'zhin.config.json',
  'zhin.config.toml',
  'zhin.config.ts',
] as const;
/** @deprecated Plugin Runtime 由 CLI 装配 Console Host，无需在配置中声明；仅用于 legacy 数组配置诊断 */
const CONSOLE_HOST_PLUGINS = ['@zhin.js/host-router', '@zhin.js/host-api'] as const;
const SANDBOX_PLUGIN = '@zhin.js/adapter-sandbox';
const LEGACY_AI_PROVIDER_FIELDS = ['driver', 'api', 'preset', 'spec'] as const;

/** 由插件包名推导默认 instanceKey（@zhin.js/adapter-telegram → telegram） */
export function packageToInstanceKey(packageName: string): string {
  const name = packageName.includes('/')
    ? packageName.split('/').pop() ?? packageName
    : packageName;
  return name.replace(/^(adapter|plugin|service)-/, '');
}

export type ProjectConfigFormat = 'yaml' | 'json' | 'toml' | 'ts';

export interface LoadedProjectConfig {
  status: 'loaded' | 'missing' | 'unsupported';
  cwd: string;
  configPath?: string;
  relativePath?: string;
  format?: ProjectConfigFormat;
  config: Record<string, unknown>;
  writable: boolean;
  message?: string;
}

export interface ProjectConfigPlanOptions {
  cwd?: string;
  loaded?: LoadedProjectConfig;
  configPath?: string;
  config?: Record<string, unknown>;
  format?: ProjectConfigFormat;
  enablePlugins?: string[];
  ensureConsole?: boolean;
  ensureSandbox?: boolean;
  ensureHttp?: boolean;
  migrateAiLegacy?: boolean;
}

export interface ProjectConfigPlan {
  cwd: string;
  status: LoadedProjectConfig['status'];
  configPath?: string;
  relativePath?: string;
  format?: ProjectConfigFormat;
  writable: boolean;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  mutations: string[];
  changed: boolean;
  message?: string;
}

export interface ConsoleConfigDiagnosis {
  missingHostPlugins: string[];
  missingSandboxPlugin: boolean;
  missingConsoleOrigin: boolean;
  missingHttpToken: boolean;
}

function configFormatFromPath(filePath: string): ProjectConfigFormat | null {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.yml' || ext === '.yaml') return 'yaml';
  if (ext === '.json') return 'json';
  if (ext === '.toml') return 'toml';
  if (ext === '.ts') return 'ts';
  return null;
}

function cloneConfig(config: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
}

function parseConfig(content: string, format: ProjectConfigFormat): Record<string, unknown> {
  if (format === 'yaml') {
    const parsed = yaml.parse(content) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  }
  if (format === 'json') {
    const parsed = JSON.parse(content) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  }
  if (format === 'toml') {
    const parsed = parseToml(content) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  }
  return {};
}

function serializeConfig(config: Record<string, unknown>, format: ProjectConfigFormat): string {
  if (format === 'json') return `${JSON.stringify(config, null, 2)}\n`;
  if (format === 'toml') return stringifyToml(config as Record<string, unknown>);
  return yaml.stringify(config);
}

function findProjectConfigPath(cwd: string): string | null {
  for (const candidate of CONFIG_CANDIDATES) {
    const configPath = path.join(cwd, candidate);
    if (fs.existsSync(configPath)) return configPath;
  }
  return null;
}

export function loadProjectConfig(cwd = process.cwd(), configPath?: string): LoadedProjectConfig {
  const resolvedPath = configPath ? path.resolve(cwd, configPath) : findProjectConfigPath(cwd);
  if (!resolvedPath) {
    return {
      status: 'missing',
      cwd,
      config: {},
      writable: false,
      message: '未找到 zhin.config.yml/json/toml',
    };
  }

  const format = configFormatFromPath(resolvedPath);
  const relativePath = path.relative(cwd, resolvedPath) || path.basename(resolvedPath);
  if (!format) {
    return {
      status: 'unsupported',
      cwd,
      configPath: resolvedPath,
      relativePath,
      config: {},
      writable: false,
      message: `${path.basename(resolvedPath)} 暂不支持自动写入`,
    };
  }

  if (format === 'ts') {
    return {
      status: 'unsupported',
      cwd,
      configPath: resolvedPath,
      relativePath,
      format,
      config: {},
      writable: false,
      message: 'zhin.config.ts 只读；请迁移为 zhin.config.yml/json/toml 后自动修复',
    };
  }

  const content = fs.readFileSync(resolvedPath, 'utf8');
  return {
    status: 'loaded',
    cwd,
    configPath: resolvedPath,
    relativePath,
    format,
    config: parseConfig(content, format),
    writable: true,
  };
}

function ensurePlugins(config: Record<string, unknown>, pluginsToAdd: readonly string[], mutations: string[]): void {
  if (Array.isArray(config.plugins)) {
    // legacy 数组形式：保持原形态追加，避免改写旧项目结构
    const plugins = config.plugins.filter((p): p is string => typeof p === 'string');
    let changed = false;
    for (const plugin of pluginsToAdd) {
      if (plugins.includes(plugin)) continue;
      plugins.push(plugin);
      mutations.push(`added ${plugin} to plugins`);
      changed = true;
    }
    if (changed) {
      config.plugins = plugins;
    }
    return;
  }
  // 新 Plugin Runtime：plugins 为 <instanceKey>: <配置> 映射
  const plugins = config.plugins && typeof config.plugins === 'object'
    ? { ...(config.plugins as Record<string, unknown>) }
    : {};
  let changed = false;
  for (const pkg of pluginsToAdd) {
    const instanceKey = packageToInstanceKey(pkg);
    if (instanceKey in plugins) continue;
    plugins[instanceKey] = {};
    mutations.push(`added ${instanceKey} (${pkg}) to plugins`);
    changed = true;
  }
  if (changed || !config.plugins || typeof config.plugins !== 'object') {
    config.plugins = plugins;
  }
}

function ensureHttp(config: Record<string, unknown>, mutations: string[]): void {
  const http = config.http && typeof config.http === 'object' && !Array.isArray(config.http)
    ? { ...(config.http as Record<string, unknown>) }
    : {};
  const corsOrigins = Array.isArray(http.corsOrigins)
    ? http.corsOrigins.filter((origin): origin is string => typeof origin === 'string')
    : [];

  let changed = false;
  if (!hasConsoleOrigin(corsOrigins)) {
    corsOrigins.push(CONSOLE_URL);
    http.corsOrigins = corsOrigins;
    mutations.push(`added ${CONSOLE_URL} to http.corsOrigins`);
    changed = true;
  }
  if (typeof http.token !== 'string' || http.token.trim().length === 0) {
    http.token = '${HTTP_TOKEN}';
    mutations.push('added http.token');
    changed = true;
  }
  if (changed || !config.http) {
    config.http = http;
  }
}

function sdkFromLegacyProvider(alias: string, provider: Record<string, unknown>): string {
  const candidates = LEGACY_AI_PROVIDER_FIELDS
    .map((field) => provider[field])
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim().toLowerCase());
  const joined = candidates.join(' ');
  if (joined.includes('ollama')) return 'ollama';
  if (joined.includes('anthropic') || joined.includes('claude')) return 'anthropic';
  if (joined.includes('google') || joined.includes('gemini')) return 'google';
  if (joined.includes('deepseek')) return 'deepseek';
  if (joined.includes('moonshot') || joined.includes('zhipu') || joined.includes('compatible')) {
    return 'openai-compatible';
  }
  return providerSdkFor(alias);
}

export function migrateAiLegacyConfig(ai: Record<string, unknown>): {
  ai: Record<string, unknown>;
  fixes: string[];
} {
  const next = cloneConfig(ai);
  const fixes: string[] = [];
  const defaultProvider = typeof next.defaultProvider === 'string' && next.defaultProvider.trim()
    ? next.defaultProvider.trim()
    : undefined;

  const providers = next.providers && typeof next.providers === 'object' && !Array.isArray(next.providers)
    ? { ...(next.providers as Record<string, unknown>) }
    : {};
  let providersChanged = false;

  for (const [alias, rawProvider] of Object.entries(providers)) {
    if (!rawProvider || typeof rawProvider !== 'object' || Array.isArray(rawProvider)) continue;
    const provider = { ...(rawProvider as Record<string, unknown>) };
    const hasLegacyField = LEGACY_AI_PROVIDER_FIELDS.some((field) => field in provider);
    if (!provider.sdk && hasLegacyField) {
      provider.sdk = sdkFromLegacyProvider(alias, provider);
      fixes.push(`migrated ai.providers.${alias}.driver/api to sdk`);
      providersChanged = true;
    }
    for (const field of LEGACY_AI_PROVIDER_FIELDS) {
      if (field in provider) {
        delete provider[field];
        providersChanged = true;
      }
    }
    providers[alias] = provider;
  }

  if (providersChanged) {
    next.providers = providers;
  }

  if (defaultProvider) {
    const agents = next.agents && typeof next.agents === 'object' && !Array.isArray(next.agents)
      ? { ...(next.agents as Record<string, unknown>) }
      : {};
    const zhin = agents.zhin && typeof agents.zhin === 'object' && !Array.isArray(agents.zhin)
      ? { ...(agents.zhin as Record<string, unknown>) }
      : {};
    if (!zhin.provider) {
      zhin.provider = defaultProvider;
      fixes.push('migrated ai.defaultProvider to ai.agents.zhin.provider');
    }
    const legacyAgent = next.agent && typeof next.agent === 'object' && !Array.isArray(next.agent)
      ? next.agent as Record<string, unknown>
      : {};
    const legacyModel = typeof legacyAgent.chatModel === 'string'
      ? legacyAgent.chatModel
      : typeof legacyAgent.visionModel === 'string'
        ? legacyAgent.visionModel
        : undefined;
    if (legacyModel && !zhin.model) {
      zhin.model = legacyModel;
      fixes.push('migrated ai.agent.chatModel to ai.agents.zhin.model');
    }
    agents.zhin = zhin;
    next.agents = agents;
    delete next.defaultProvider;
  }

  return { ai: next, fixes };
}

function applyAiLegacyMigration(config: Record<string, unknown>, mutations: string[]): void {
  if (!config.ai || typeof config.ai !== 'object' || Array.isArray(config.ai)) return;
  const { ai, fixes } = migrateAiLegacyConfig(config.ai as Record<string, unknown>);
  if (fixes.length === 0) return;
  config.ai = ai;
  mutations.push(...fixes);
}

export function createProjectConfigPlan(options: ProjectConfigPlanOptions): ProjectConfigPlan {
  const cwd = options.cwd ?? options.loaded?.cwd ?? process.cwd();
  const loaded = options.loaded ?? (
    options.config
      ? {
        status: 'loaded' as const,
        cwd,
        configPath: options.configPath,
        relativePath: options.configPath ? path.relative(cwd, options.configPath) : undefined,
        format: options.format ?? (options.configPath ? configFormatFromPath(options.configPath) ?? undefined : undefined),
        config: options.config,
        writable: Boolean(options.configPath && (options.format ?? configFormatFromPath(options.configPath)) !== 'ts'),
      }
      : loadProjectConfig(cwd, options.configPath)
  );

  const sourceConfig = options.config ?? loaded.config;
  const before = cloneConfig(sourceConfig);
  const after = cloneConfig(sourceConfig);
  const mutations: string[] = [];

  if (loaded.status === 'loaded' || options.config) {
    if (options.ensureConsole && Array.isArray(after.plugins)) {
      // legacy 数组形态：host 插件仍需写入列表（旧项目行为不变）
      ensurePlugins(after, CONSOLE_HOST_PLUGINS, mutations);
    }
    if (options.ensureSandbox) {
      ensurePlugins(after, [SANDBOX_PLUGIN], mutations);
    }
    if (options.enablePlugins?.length) {
      ensurePlugins(after, options.enablePlugins, mutations);
    }
    if (options.ensureConsole || options.ensureHttp) {
      // 新形态下 Console Host 由 CLI composition root 装配；Console 可达只需 http.token + corsOrigins
      ensureHttp(after, mutations);
    }
    if (options.migrateAiLegacy) {
      applyAiLegacyMigration(after, mutations);
    }
  }

  return {
    cwd,
    status: loaded.status,
    configPath: loaded.configPath,
    relativePath: loaded.relativePath,
    format: loaded.format,
    writable: loaded.writable,
    before,
    after,
    mutations,
    changed: mutations.length > 0,
    message: loaded.message,
  };
}

export function renderProjectConfigPatch(plan: ProjectConfigPlan): string {
  if (!plan.changed) return '配置无需改动。';
  const format = plan.format && plan.format !== 'ts' ? plan.format : 'yaml';
  const name = plan.relativePath ?? 'zhin.config.yml';
  return [
    `# ${name}`,
    serializeConfig(plan.after, format).trimEnd(),
    '',
  ].join('\n');
}

export async function applyProjectConfigPlan(plan: ProjectConfigPlan): Promise<boolean> {
  if (!plan.changed) return false;
  if (!plan.writable || !plan.configPath || !plan.format || plan.format === 'ts') return false;
  await fs.writeFile(plan.configPath, serializeConfig(plan.after, plan.format));
  return true;
}

export function diagnoseConsoleConfig(config: Record<string, unknown>): ConsoleConfigDiagnosis {
  const http = config.http && typeof config.http === 'object' && !Array.isArray(config.http)
    ? config.http as Record<string, unknown>
    : {};
  const corsOrigins = Array.isArray(http.corsOrigins) ? http.corsOrigins : [];

  if (Array.isArray(config.plugins)) {
    // legacy 数组形式配置
    const plugins = config.plugins.filter((p): p is string => typeof p === 'string');
    return {
      missingHostPlugins: CONSOLE_HOST_PLUGINS.filter((plugin) => !plugins.includes(plugin)),
      missingSandboxPlugin: !plugins.includes(SANDBOX_PLUGIN),
      missingConsoleOrigin: !hasConsoleOrigin(corsOrigins.filter((origin): origin is string => typeof origin === 'string')),
      missingHttpToken: typeof http.token !== 'string' || http.token.trim().length === 0,
    };
  }

  // 新 Plugin Runtime：Console Host 由 CLI 装配，无需 host 插件；Sandbox 为 plugins.sandbox 实例
  const plugins = config.plugins && typeof config.plugins === 'object'
    ? config.plugins as Record<string, unknown>
    : {};
  return {
    missingHostPlugins: [],
    missingSandboxPlugin: !('sandbox' in plugins),
    missingConsoleOrigin: !hasConsoleOrigin(corsOrigins.filter((origin): origin is string => typeof origin === 'string')),
    missingHttpToken: typeof http.token !== 'string' || http.token.trim().length === 0,
  };
}

function hasConsoleOrigin(origins: readonly string[]): boolean {
  return origins.some((origin) => {
    try {
      return new URL(origin).origin === CONSOLE_URL;
    } catch {
      return false;
    }
  });
}

export function applyConsoleConfigFixes(config: Record<string, unknown>): boolean {
  const plan = createProjectConfigPlan({
    cwd: process.cwd(),
    config,
    ensureConsole: true,
    ensureSandbox: true,
    ensureHttp: true,
    migrateAiLegacy: true,
  });
  Object.keys(config).forEach((key) => delete config[key]);
  Object.assign(config, plan.after);
  return plan.changed;
}
